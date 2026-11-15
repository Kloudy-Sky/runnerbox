import type { QueueView, WaitingJob } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { createGitHubReader } from "../github/githubReader.ts";
import { readReportToken } from "../github/reportToken.ts";
import * as StateLogs from "../history/StateLogs.ts";
import { afterPoll, type Outcome, reposToPoll, runIds, waitingJobs } from "./queueRules.ts";
import { QueueConfig } from "./QueueConfig.ts";
import * as RunnerState from "./RunnerState.ts";

const DAY_MS = 86_400_000;
// A repo counts as active by its newest job in this window, for choosing which to poll.
const ACTIVE_DAYS = 14;
const OFF: QueueView = { status: "off", reason: null, waiting: [], resumesAt: null, reposLeftOut: 0, checkedAt: null };

// The jobs GitHub has queued for this machine's labels. It calls GitHub only while someone watches
// `changes`, and for a minute after the last one leaves, with the read-only token from report.env.
export class RunnerQueue extends Context.Service<RunnerQueue, { readonly changes: Stream.Stream<QueueView> }>()("runnerbox/server/RunnerQueue") {}

const make = Effect.gen(function* () {
  const config = yield* QueueConfig;
  const logs = yield* StateLogs.StateLogs;
  const runnerState = yield* RunnerState.RunnerState;
  const get = createGitHubReader(config.apiBase);
  const view = yield* SubscriptionRef.make(OFF);
  const watchers = yield* Ref.make(0);
  const lastLeft = yield* Ref.make(Number.NEGATIVE_INFINITY);
  const failures = yield* Ref.make(0);
  const lastRefusal = yield* Ref.make<string | null>(null);
  const { timing } = config;

  // The repos with job history, the most recently active first.
  const activity = Effect.gen(function* () {
    const since = (yield* Clock.currentTimeMillis) - ACTIVE_DAYS * DAY_MS;
    const repos = yield* logs.repos;
    return yield* Effect.forEach(repos, (repo) =>
      logs.jobs(repo, since).pipe(Effect.map((jobs) => ({ repo, lastAt: Math.max(0, ...jobs.map((job) => Date.parse(job.createdAt))) }))),
    );
  }).pipe(Effect.orElseSucceed(() => []));

  // One look at GitHub. Returns how long to wait before the next.
  const poll = Effect.gen(function* () {
    const read = yield* Effect.promise(() => readReportToken(config.reportEnvPath));
    if ("refused" in read) {
      if ((yield* Ref.get(lastRefusal)) !== read.refused) yield* Effect.logWarning(`queue: not checking GitHub: ${read.refused}`);
      yield* Ref.set(lastRefusal, read.refused);
      yield* SubscriptionRef.set(view, OFF);
      return timing.pollMs;
    }
    yield* Ref.set(lastRefusal, null);
    const installs = yield* runnerState.current.pipe(Effect.orElseSucceed(() => []));
    const labels = new Set(installs.filter((install) => !install.stale).flatMap((install) => install.kinds.map((kind) => kind.label)));
    const { repos, leftOut } = reposToPoll(yield* activity);

    let outcome: Outcome = { kind: "ok", budget: null };
    const waiting: WaitingJob[] = [];
    // A failed reply ends this look; the rest of the repos wait for the next.
    const fetch = (path: string) =>
      Effect.promise(() => get(path, read.token)).pipe(
        Effect.map((reply) => {
          if (reply.kind === "ok") outcome = { kind: "ok", budget: reply.budget ?? (outcome.kind === "ok" ? outcome.budget : null) };
          else if (reply.kind === "limited") outcome = { kind: "limited", untilMs: reply.untilMs };
          else if (reply.kind === "refused") outcome = { kind: "refused", status: reply.status };
          else if (reply.kind === "error") outcome = { kind: "error", message: reply.message };
          return reply;
        }),
      );
    // With no runner labels live, nothing could match, so GitHub isn't asked.
    if (labels.size > 0) {
      polling: for (const repo of repos) {
        const replies: unknown[] = [];
        for (const status of ["queued", "in_progress"]) {
          const reply = yield* fetch(`repos/${repo}/actions/runs?status=${status}&per_page=20`);
          if (reply.kind === "missing") continue polling;
          if (reply.kind !== "ok") break polling;
          replies.push(reply.body);
        }
        for (const id of runIds(replies)) {
          const reply = yield* fetch(`repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`);
          if (reply.kind === "missing") continue;
          if (reply.kind !== "ok") break polling;
          waiting.push(...waitingJobs(repo, reply.body, labels));
        }
      }
    }

    const now = yield* Clock.currentTimeMillis;
    const next = afterPoll(outcome, yield* Ref.get(failures), timing, now);
    yield* Ref.set(failures, next.failures);
    const previous = yield* SubscriptionRef.get(view);
    yield* SubscriptionRef.set(view, {
      status: next.status,
      reason: next.reason,
      resumesAt: next.resumesAt,
      // A failed look keeps the last list it had rather than showing nothing waiting.
      waiting: outcome.kind === "ok" ? waiting.toSorted((a, b) => Date.parse(a.since) - Date.parse(b.since)) : previous.waiting,
      reposLeftOut: leftOut,
      checkedAt: outcome.kind === "ok" ? new Date(now).toISOString() : previous.checkedAt,
    });
    return next.delayMs;
  });

  const watched = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return (yield* Ref.get(watchers)) > 0 || now - (yield* Ref.get(lastLeft)) < timing.idleMs;
  });

  yield* Effect.forkScoped(
    Effect.forever(Effect.gen(function* () {
      if (!(yield* watched)) return yield* Effect.sleep(timing.checkMs);
      yield* Effect.sleep(yield* poll);
    })),
  );

  const changes = Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Ref.update(watchers, (count) => count + 1), () =>
        Effect.gen(function* () {
          yield* Ref.set(lastLeft, yield* Clock.currentTimeMillis);
          yield* Ref.update(watchers, (count) => count - 1);
        }),
      );
      return SubscriptionRef.changes(view);
    }),
  );

  return RunnerQueue.of({ changes });
});

export const layer = Layer.effect(RunnerQueue, make);
