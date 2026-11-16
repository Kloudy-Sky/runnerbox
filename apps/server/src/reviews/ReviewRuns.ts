import { join } from "node:path";
import { BUILT_IN_ACCOUNT_ID, type PullReviews, type Review, ReviewError } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as AccountStore from "../accounts/AccountStore.ts";
import * as AuthStore from "../auth/AuthStore.ts";
import { newId } from "../auth/secrets.ts";
import * as LocalEndpoint from "../config/LocalEndpoint.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import type { SubmittedReview } from "../mcp/reviewTool.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import { Drivers } from "../threads/provider/Drivers.ts";
import type { TurnAccount } from "../threads/provider/ProviderAdapter.ts";
import { appRequest } from "./appRequest.ts";
import * as GitHubApp from "./GitHubApp.ts";
import { type FileLines, fetchCommits, type GitResult, type Listed, listPaths, type Matches, MAX_READ_LINES, readLines, searchLines } from "./gitObjects.ts";
import { pullDiff } from "./pullDiff.ts";
import { type PullToReview, pullToReview } from "./pullRequests.ts";
import { reviewableDiff } from "./reviewableDiff.ts";
import { REVIEW_SYSTEM_PROMPT, reviewPrompt } from "./reviewPrompt.ts";
import * as Reviews from "./Reviews.ts";
import * as ReviewStore from "./ReviewStore.ts";

// Runs a review: fetches the pull request's head commit into a bare repository on this machine,
// gives a Claude turn the diff and tools that read that commit, and keeps what it hands in. The
// agent gets no checkout, no shell and none of runnerbox's other tools, and nothing is posted to
// GitHub. One review runs at a time; the rest wait their turn.

const GITHUB_GIT = "https://github.com";
// More than this is too much to review well in one pass, and the review says so instead. Lockfiles
// and generated files don't count. The diff's size is bounded too, so it fits beside the code the
// reviewer has to read.
const MAX_CHANGED_LINES = 3000;
const MAX_DIFF_CHARS = 300_000;
const TOO_LARGE = "This pull request changes more than 3,000 lines outside lockfiles and generated files, which is too much to review well.";
const REVIEW_LIMIT = "20 minutes";
// The turn's MCP token is revoked when the review ends. This only bounds one a crash left behind.
const TOKEN_TTL_MS = 30 * 60_000;
const EXCERPT_LINES = 40;

class ReviewFailed extends Schema.TaggedError<ReviewFailed>()("ReviewFailed", { why: Schema.String }) {}
export type ToolRefused = { readonly message: string };

// What a review's turn may read, and what it handed in.
type Reading = { readonly dir: string; readonly commit: string; readonly opened: Set<string>; submitted: SubmittedReview | null };
type Run = { review: Review; stopped: boolean; fiber?: Fiber.Fiber<void, unknown> };

export class ReviewRuns extends Context.Service<
  ReviewRuns,
  {
    readonly read: (repo: string, number: number, canReview: boolean) => Effect.Effect<PullReviews, ReviewError>;
    // Checks the pull request can be reviewed, records the review and returns it; the work goes on
    // in the background and ends in the store.
    readonly start: (repo: string, number: number) => Effect.Effect<Review, ReviewError>;
    // Returns once the review has ended and that's kept.
    readonly stop: (repo: string, number: number) => Effect.Effect<Review, ReviewError>;
    // The agent's tools, for the review its turn's token is bound to.
    readonly readFile: (sessionId: string, path: string, from: number | undefined, to: number | undefined) => Effect.Effect<FileLines, ToolRefused>;
    readonly search: (sessionId: string, pattern: string, options: { readonly glob?: string | undefined; readonly ignoreCase?: boolean | undefined }) => Effect.Effect<Matches, ToolRefused>;
    readonly listFiles: (sessionId: string, glob: string | undefined) => Effect.Effect<Listed, ToolRefused>;
    readonly submit: (sessionId: string, review: SubmittedReview) => Effect.Effect<void, ToolRefused>;
  }
>()("runnerbox/server/reviews/ReviewRuns") {}

const nowIso = Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()));

const make = Effect.gen(function* () {
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const config = yield* QueueConfig;
  const app = yield* GitHubApp.GitHubApp;
  const reviews = yield* Reviews.Reviews;
  const store = yield* ReviewStore.ReviewStore;
  const accounts = yield* AccountStore.AccountStore;
  const auth = yield* AuthStore.AuthStore;
  const endpoint = yield* LocalEndpoint.LocalEndpoint;
  const claude = (yield* Drivers).get("claude");
  const scope = yield* Effect.scope;
  const gitBase = config.gitBase ?? GITHUB_GIT;
  // `repo` has passed RepoName, so its two parts are safe as directory names.
  const codeDir = (repo: string) => join(serverDir, "review-code", ...repo.split("/"));
  const keyOf = (repo: string, number: number) => `${repo}#${number}`;

  const runs = new Map<string, Run>();
  const readings = new Map<string, Reading>();
  const lock = yield* Semaphore.make(1);
  const oneAtATime = yield* Semaphore.make(1);

  const keep = (run: Run, change: Partial<Review>) =>
    Effect.suspend(() => {
      run.review = { ...run.review, ...change };
      return store.put(run.review);
    });

  // A review runs on a Claude account: the owner's default when it is one, else Runnerbox's own login.
  const reviewer = Effect.gen(function* () {
    const preferred = yield* accounts.resolve(undefined);
    return preferred.driver === "claude" ? preferred : yield* accounts.resolve(BUILT_IN_ACCOUNT_ID);
  }).pipe(Effect.mapError(() => new ReviewError({ reason: "unreadable" })));

  const gitFailure = <A>(result: GitResult<A>): Effect.Effect<A, ReviewFailed> => (result.ok ? Effect.succeed(result.value) : Effect.fail(new ReviewFailed({ why: result.why })));

  // The lines a finding points at, as the owner will see them. A path or range the agent got wrong leaves it without.
  const excerpt = (reading: Reading, finding: SubmittedReview["findings"][number]) => {
    const [from, to] = finding.startLine <= finding.endLine ? [finding.startLine, finding.endLine] : [finding.endLine, finding.startLine];
    return Effect.promise((signal) => readLines(reading.dir, reading.commit, finding.path, from, Math.min(to, from + EXCERPT_LINES - 1), signal)).pipe(
      Effect.map((read) => ({ ...finding, startLine: from, endLine: to, code: read.ok ? read.value.lines : [] })),
    );
  };

  const work = (run: Run, pull: PullToReview, account: TurnAccount) =>
    Effect.gen(function* () {
      yield* keep(run, { state: "running" });
      // Made now, not when the review was asked for: a review that waited its turn would find an older one expired.
      const token = yield* app.codeToken(pull.repo);
      const dir = codeDir(pull.repo);
      // Stopping the review ends git too, so it never outlives the review holding the repository's locks or the token.
      yield* Effect.promise((signal) => fetchCommits(dir, `${gitBase}/${pull.repo}.git`, token, [pull.headSha], signal)).pipe(Effect.flatMap(gitFailure));
      const diff = yield* Effect.promise(() => pullDiff(config.apiBase, pull.repo, pull.baseSha, pull.headSha, token));
      if (diff.kind === "too_large") return yield* new ReviewFailed({ why: TOO_LARGE });
      if (diff.kind === "error") return yield* new ReviewFailed({ why: `Couldn't get the diff from GitHub: ${diff.message}.` });
      const shown = reviewableDiff(diff.diff);
      if (shown.changedLines > MAX_CHANGED_LINES || shown.diff.length > MAX_DIFF_CHARS) return yield* new ReviewFailed({ why: TOO_LARGE });
      const grant = yield* Effect.acquireRelease(auth.mintMcpToken("review", { ttlMs: TOKEN_TTL_MS }), ({ session }) => auth.revoke(session.id).pipe(Effect.ignore));
      const reading: Reading = { dir, commit: pull.headSha, opened: new Set(), submitted: null };
      yield* Effect.acquireRelease(
        Effect.sync(() => readings.set(grant.session.id, reading)),
        () => Effect.sync(() => readings.delete(grant.session.id)),
      );
      let costUsd: number | null = null;
      const turn = yield* claude
        .runTurn({
          systemPrompt: REVIEW_SYSTEM_PROMPT,
          prompt: reviewPrompt(pull, shown.diff),
          images: [],
          mcp: { url: `${yield* endpoint.baseUrl}/mcp`, token: grant.token },
          reproduce: false,
          propose: false,
          review: true,
          account,
        })
        .pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event._tag === "Done") costUsd = event.costUsd;
            }),
          ),
          Effect.exit,
        );
      // A review that was handed in is kept however the turn ended after it, such as out of steps on
      // its last call. Only a turn that handed nothing in fails, with its own reason when it has one.
      const submitted = reading.submitted;
      if (submitted === null) return yield* Exit.isFailure(turn) ? Effect.failCause(turn.cause) : new ReviewFailed({ why: "The reviewer ended without handing in a review." });
      const findings = yield* Effect.forEach(submitted.findings, (finding) => excerpt(reading, finding));
      yield* keep(run, { state: "done", finishedAt: yield* nowIso, costUsd, filesRead: reading.opened.size, score: submitted.score, impact: submitted.impact, reach: submitted.reach, verdict: submitted.verdict, findings });
    }).pipe(Effect.scoped, Effect.timeoutOrElse({ duration: REVIEW_LIMIT, orElse: () => Effect.fail(new ReviewFailed({ why: "The review took longer than 20 minutes and was stopped." })) }));

  // However the work ended, the review says so. A stop by the server leaves it to read as cut short.
  const ended = (run: Run, exit: Exit.Exit<void, ReviewFailed | ReviewError | { readonly message: string }>) =>
    Effect.gen(function* () {
      runs.delete(keyOf(run.review.repo, run.review.number));
      if (Exit.isSuccess(exit)) return;
      const finishedAt = yield* nowIso;
      if (Cause.hasInterruptsOnly(exit.cause)) return run.stopped ? yield* keep(run, { state: "stopped", finishedAt }) : undefined;
      const error = Cause.squash(exit.cause);
      const problem = error instanceof ReviewFailed ? error.why : error instanceof Error ? error.message : "The review failed.";
      yield* keep(run, { state: "failed", finishedAt, problem });
    }).pipe(Effect.ignore);

  const start = Effect.fn("ReviewRuns.start")(function* (repo: string, number: number) {
    if ((yield* app.describe) === null) return yield* new ReviewError({ reason: "not_connected" });
    const settings = yield* reviews.settings;
    if (!settings.repos.includes(repo)) return yield* new ReviewError({ reason: "reviews_off" });
    const account = yield* reviewer;
    const status = yield* claude.status({ hasKey: account.apiKey !== null, home: account.home });
    if (!status.available) return yield* new ReviewError({ reason: "provider_unavailable" });
    const installed = yield* app.installed;
    const found = installed.repos.find((each) => each.repo === repo);
    if (found === undefined) return yield* new ReviewError({ reason: installed.problem === null ? "unknown_repo" : "github_unreachable" });
    const reply = yield* Effect.promise(() => appRequest(config.apiBase, "GET", `repos/${repo}/pulls/${number}`, found.token));
    if (reply.kind === "error") return yield* new ReviewError({ reason: "github_unreachable" });
    const pull = reply.kind === "ok" ? pullToReview(repo, reply.body) : null;
    if (pull === null) return yield* new ReviewError({ reason: "pull_not_found" });
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const key = keyOf(repo, number);
        if (runs.has(key)) return yield* new ReviewError({ reason: "review_running" });
        const review: Review = {
          id: newId(),
          repo,
          number,
          title: pull.title,
          author: pull.author,
          branch: pull.branch,
          base: pull.base,
          headSha: pull.headSha,
          additions: pull.additions,
          deletions: pull.deletions,
          changedFiles: pull.changedFiles,
          state: "queued",
          startedAt: yield* nowIso,
          finishedAt: null,
          model: settings.model,
          costUsd: null,
          filesRead: 0,
          score: null,
          impact: null,
          reach: null,
          verdict: null,
          findings: [],
          problem: null,
        };
        yield* store.put(review);
        const run: Run = { review, stopped: false };
        runs.set(key, run);
        // Forked into the service's scope, so stopping the server interrupts it.
        run.fiber = yield* store.live(review.id, oneAtATime.withPermits(1)(work(run, pull, { label: account.label, model: settings.model, apiKey: account.apiKey, home: account.home })).pipe(Effect.onExit((exit) => ended(run, exit)))).pipe(Effect.forkIn(scope));
        return review;
      }),
    );
  });

  const stop = Effect.fn("ReviewRuns.stop")(function* (repo: string, number: number) {
    const run = runs.get(keyOf(repo, number));
    if (run === undefined) return yield* new ReviewError({ reason: "no_review" });
    run.stopped = true;
    if (run.fiber) yield* Fiber.interrupt(run.fiber);
    return run.review;
  });

  const read = (repo: string, number: number, canReview: boolean) => store.list(repo, number).pipe(Effect.map((kept) => ({ reviews: kept, canReview })));

  const reading = (sessionId: string): Effect.Effect<Reading, ToolRefused> => {
    const found = readings.get(sessionId);
    return found === undefined ? Effect.fail({ message: "Only a review's own turn can read its code." }) : Effect.succeed(found);
  };
  const answer = <A>(result: GitResult<A>): Effect.Effect<A, ToolRefused> => (result.ok ? Effect.succeed(result.value) : Effect.fail({ message: result.why }));

  const readFile = (sessionId: string, path: string, from: number | undefined, to: number | undefined) =>
    reading(sessionId).pipe(
      Effect.flatMap((found) =>
        Effect.promise((signal) => readLines(found.dir, found.commit, path, from ?? 1, to ?? (from ?? 1) + MAX_READ_LINES - 1, signal)).pipe(
          Effect.flatMap(answer),
          Effect.tap(() => Effect.sync(() => found.opened.add(path))),
        ),
      ),
    );
  const search = (sessionId: string, pattern: string, options: { readonly glob?: string | undefined; readonly ignoreCase?: boolean | undefined }) =>
    reading(sessionId).pipe(Effect.flatMap((found) => Effect.promise((signal) => searchLines(found.dir, found.commit, pattern, options, signal))), Effect.flatMap(answer));
  const listFiles = (sessionId: string, glob: string | undefined) =>
    reading(sessionId).pipe(Effect.flatMap((found) => Effect.promise((signal) => listPaths(found.dir, found.commit, glob, signal))), Effect.flatMap(answer));
  const submit = (sessionId: string, review: SubmittedReview) => reading(sessionId).pipe(Effect.map((found) => void (found.submitted = review)));

  return ReviewRuns.of({ read, start, stop, readFile, search, listFiles, submit });
});

export const layer = Layer.effect(ReviewRuns, make);
