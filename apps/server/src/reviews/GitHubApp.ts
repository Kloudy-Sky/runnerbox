import { join } from "node:path";
import { type ReviewApp, ReviewError } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { REPO_NAME } from "runnerbox/src/github/github-client.ts";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import { appJwt } from "./appJwt.ts";
import { appRequest } from "./appRequest.ts";

// The owner's own GitHub App: its ID and private key in `.server/github-app.json`, owner-only. The
// key is read back only to sign the App's short-lived tokens, here. It's never returned over RPC,
// logged, given to an agent or put in a thread. What leaves this service is a token for one
// installation that can only read pull requests, and lasts an hour. A review gets one more, for its
// one repository, that can also read the code.

const AppFile = Schema.Struct({ v: Schema.Literal(1), appId: Schema.String, privateKey: Schema.String, slug: Schema.String, name: Schema.String });
type AppFile = typeof AppFile.Type;
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AppFile));

// GitHub's replies are outside input: only these fields are read.
const decodeApp = Schema.decodeUnknownOption(Schema.Struct({ slug: Schema.String, name: Schema.String }));
const decodeInstallations = Schema.decodeUnknownOption(Schema.Array(Schema.Struct({ id: Schema.Int })));
const decodeAccessToken = Schema.decodeUnknownOption(Schema.Struct({ token: Schema.String, expires_at: Schema.String }));
const decodeRepositories = Schema.decodeUnknownOption(Schema.Struct({ total_count: Schema.Int, repositories: Schema.Array(Schema.Struct({ full_name: Schema.String })) }));

const REPOS_PER_PAGE = 100;
const MAX_REPO_PAGES = 5;
// How long the list of installed repositories is believed before GitHub is asked again.
const REPOS_FRESH_MS = 5 * 60_000;
// A token this close to its end isn't handed out.
const TOKEN_MARGIN_MS = 5 * 60_000;
// After a look that failed, GitHub isn't asked again for this long, however many clients ask.
const RETRY_AFTER_MS = 60_000;

// A repository the App is installed on, and a token that reads its pull requests.
export type InstalledRepo = { readonly repo: string; readonly token: string; readonly installation: number };
type Installed = { readonly at: number; readonly expiresAt: number; readonly repos: ReadonlyArray<InstalledRepo> };

export class GitHubApp extends Context.Service<
  GitHubApp,
  {
    readonly describe: Effect.Effect<ReviewApp | null, ReviewError>;
    // Checks the ID and key against GitHub before keeping them.
    readonly connect: (appId: string, privateKey: string) => Effect.Effect<ReviewApp, ReviewError>;
    readonly disconnect: Effect.Effect<void, ReviewError>;
    // Every repository the App is installed on. `problem` says why the list is the last one known,
    // or empty, when GitHub couldn't be asked.
    readonly installed: Effect.Effect<{ readonly repos: ReadonlyArray<InstalledRepo>; readonly problem: string | null }, ReviewError>;
    // A new token for one repository alone, that reads its code and pull requests and writes nothing.
    readonly codeToken: (repo: string) => Effect.Effect<string, ReviewError>;
  }
>()("runnerbox/server/reviews/GitHubApp") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const { apiBase } = yield* QueueConfig;
  const path = join(serverDir, "github-app.json");
  const unreadable = () => new ReviewError({ reason: "unreadable" });
  // One refresh at a time, so two clients asking together mint one set of tokens.
  const refreshing = yield* Semaphore.make(1);
  let cache: Installed | null = null;
  let failed: { readonly at: number; readonly problem: string } | null = null;
  const forget = Effect.sync(() => {
    cache = null;
    failed = null;
  });

  const read = fs.readFileString(path).pipe(
    Effect.map(Option.some),
    Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(Option.none<string>()) : Effect.fail(error))),
    Effect.flatMap((text) => (Option.isSome(text) ? decodeFile(text.value) : Effect.succeed(null))),
    Effect.mapError(unreadable),
  );
  const ask = (method: "GET" | "POST", requestPath: string, token: string, body?: object) => Effect.promise(() => appRequest(apiBase, method, requestPath, token, body));

  const describe = read.pipe(Effect.map((file) => (file === null ? null : { slug: file.slug, name: file.name })));

  const connect = Effect.fn("GitHubApp.connect")(function* (appId: string, privateKey: string) {
    const jwt = appJwt(appId, privateKey, yield* Clock.currentTimeMillis);
    if (jwt === null) return yield* new ReviewError({ reason: "bad_key" });
    const reply = yield* ask("GET", "app", jwt);
    if (reply.kind === "refused") return yield* new ReviewError({ reason: "app_refused" });
    const app = reply.kind === "ok" ? decodeApp(reply.body) : Option.none();
    if (Option.isNone(app)) return yield* new ReviewError({ reason: "github_unreachable" });
    const file: AppFile = { v: 1, appId, privateKey: privateKey.trim(), slug: app.value.slug, name: app.value.name };
    yield* fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify(file)}\n`)), Effect.mapError(unreadable));
    yield* forget;
    return { slug: file.slug, name: file.name };
  });

  const disconnect = fs.remove(path, { force: true }).pipe(Effect.mapError(unreadable), Effect.andThen(forget));

  // Every installation's repositories, each with that installation's token. The first reply that
  // isn't what's expected ends the look with why.
  const fetchInstalled = Effect.fn("GitHubApp.fetchInstalled")(function* (file: AppFile, now: number) {
    const jwt = appJwt(file.appId, file.privateKey, now);
    if (jwt === null) return { problem: "The App's key on the server can't be read as a private key. Connect the App again." } as const;
    const listed = yield* ask("GET", "app/installations?per_page=100", jwt);
    if (listed.kind === "refused") return { problem: "GitHub refused the App's key. Connect the App again." } as const;
    const installations = listed.kind === "ok" ? decodeInstallations(listed.body) : Option.none();
    if (Option.isNone(installations)) return { problem: `Couldn't list where the App is installed${listed.kind === "error" ? `: ${listed.message}` : ""}.` } as const;
    const repos: InstalledRepo[] = [];
    let expiresAt = Number.POSITIVE_INFINITY;
    for (const { id } of installations.value) {
      // Asked for less than the App holds: this token can't write, whatever the App may.
      const minted = yield* ask("POST", `app/installations/${id}/access_tokens`, jwt, { permissions: { pull_requests: "read" } });
      const access = minted.kind === "ok" ? decodeAccessToken(minted.body) : Option.none();
      if (Option.isNone(access)) return { problem: "Couldn't get a token for one of the App's installations. It needs the Pull requests permission." } as const;
      expiresAt = Math.min(expiresAt, Date.parse(access.value.expires_at));
      for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
        const reply = yield* ask("GET", `installation/repositories?per_page=${REPOS_PER_PAGE}&page=${page}`, access.value.token);
        const body = reply.kind === "ok" ? decodeRepositories(reply.body) : Option.none();
        if (Option.isNone(body)) return { problem: "Couldn't list the repositories the App is installed on." } as const;
        // Only names that pass the core's pattern ever go into a request path.
        repos.push(...body.value.repositories.filter(({ full_name }) => REPO_NAME.test(full_name)).map(({ full_name }) => ({ repo: full_name, token: access.value.token, installation: id })));
        if (page * REPOS_PER_PAGE >= body.value.total_count) break;
      }
    }
    return { installed: { at: now, expiresAt, repos: repos.toSorted((a, b) => a.repo.localeCompare(b.repo)) } } as const;
  });

  const installed = refreshing.withPermits(1)(
    Effect.gen(function* () {
      const file = yield* read;
      if (file === null) return { repos: [], problem: null };
      const now = yield* Clock.currentTimeMillis;
      const usable = cache !== null && cache.expiresAt - now > TOKEN_MARGIN_MS ? cache : null;
      if (usable !== null && now - usable.at < REPOS_FRESH_MS) return { repos: usable.repos, problem: null };
      // The last list is shown while its tokens still work, with why it wasn't refreshed.
      if (failed !== null && now - failed.at < RETRY_AFTER_MS) return { repos: usable?.repos ?? [], problem: failed.problem };
      const fetched = yield* fetchInstalled(file, now);
      if ("installed" in fetched) {
        cache = fetched.installed;
        failed = null;
        return { repos: fetched.installed.repos, problem: null };
      }
      failed = { at: now, problem: fetched.problem };
      return { repos: usable?.repos ?? [], problem: fetched.problem };
    }),
  );

  const codeToken = Effect.fn("GitHubApp.codeToken")(function* (repo: string) {
    const file = yield* read;
    if (file === null) return yield* new ReviewError({ reason: "not_connected" });
    const listed = yield* installed;
    const found = listed.repos.find((each) => each.repo === repo);
    if (found === undefined) return yield* new ReviewError({ reason: listed.problem === null ? "unknown_repo" : "github_unreachable" });
    const jwt = appJwt(file.appId, file.privateKey, yield* Clock.currentTimeMillis);
    if (jwt === null) return yield* new ReviewError({ reason: "bad_key" });
    const minted = yield* ask("POST", `app/installations/${found.installation}/access_tokens`, jwt, { repositories: [repo.slice(repo.indexOf("/") + 1)], permissions: { contents: "read", pull_requests: "read" } });
    // GitHub answers 422 when the App was never given a permission the token asks for.
    if (minted.kind === "error") return yield* new ReviewError({ reason: minted.status === 422 ? "no_code_access" : "github_unreachable" });
    const access = minted.kind === "ok" ? decodeAccessToken(minted.body) : Option.none();
    if (Option.isNone(access)) return yield* new ReviewError({ reason: "app_refused" });
    return access.value.token;
  });

  return GitHubApp.of({ describe, connect, disconnect, installed, codeToken });
});

export const layer = Layer.effect(GitHubApp, make);
