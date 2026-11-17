import type { GitHubAppName, GitHubError, GitHubInstallation, GitHubStatus } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { REPO_NAME } from "runnerbox/src/github/github-client.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import { githubRequest } from "./githubRequest.ts";
import * as GitHubSignIn from "./GitHubSignIn.ts";

// What the server's sign-in reaches: the accounts the App is installed on that the signed-in user
// can see, and their repositories. The user's token can't be narrowed, so what the App was given
// on those repositories is everything `serve` can do there.

// GitHub's replies are outside input: only these fields are read.
const decodeInstallations = Schema.decodeUnknownOption(
  Schema.Struct({ installations: Schema.Array(Schema.Struct({ id: Schema.Int, repository_selection: Schema.String, account: Schema.NullOr(Schema.Struct({ login: Schema.String })), html_url: Schema.optionalKey(Schema.String) })) }),
);
const decodeRepositories = Schema.decodeUnknownOption(Schema.Struct({ total_count: Schema.Int, repositories: Schema.Array(Schema.Struct({ full_name: Schema.String })) }));

const REPOS_PER_PAGE = 100;
const MAX_REPO_PAGES = 5;
// How long what's installed is believed before GitHub is asked again. The settings page asks for
// it newer, so an install shows soon after the owner comes back from making it.
const INSTALLED_FRESH_MS = 5 * 60_000;
const SETTINGS_FRESH_MS = 15_000;
// After a look that failed, GitHub isn't asked again for this long, however many clients ask.
const RETRY_AFTER_MS = 60_000;
// An installation's page is shown as a link, so only one on GitHub's own site is passed on.
const MANAGE_URL = /^https:\/\/github\.com\/[\w./-]+$/;
const ACCOUNT = /^[\w-]{1,60}$/;

type Installed = { readonly installations: ReadonlyArray<GitHubInstallation>; readonly repos: ReadonlyArray<string> };
// What a signed-in server works with: the App, a token good for now, and what was installed when last looked.
export type Reach = Installed & { readonly app: GitHubAppName; readonly token: string; readonly problem: string | null };
export type May = { readonly configure: boolean };

export class GitHub extends Context.Service<
  GitHub,
  {
    // Null when the server isn't signed in. `problem` says why the lists are the last ones known, or
    // empty, when GitHub couldn't be asked.
    readonly reach: Effect.Effect<Reach | null, GitHubError>;
    // `may` is what the asking session may do, which every status says back.
    readonly status: (may: May) => Effect.Effect<GitHubStatus, GitHubError>;
    readonly signIn: (may: May) => Effect.Effect<GitHubStatus, GitHubError>;
    readonly cancelSignIn: (may: May) => Effect.Effect<GitHubStatus, GitHubError>;
    readonly signOut: (may: May) => Effect.Effect<GitHubStatus, GitHubError>;
  }
>()("runnerbox/server/github/GitHub") {}

const make = Effect.gen(function* () {
  const { apiBase } = yield* QueueConfig;
  const signedIn = yield* GitHubSignIn.GitHubSignIn;
  // One look at a time, so two clients asking together ask GitHub once.
  const looking = yield* Semaphore.make(1);
  let cache: (Installed & { readonly at: number; readonly epoch: number }) | null = null;
  let failed: { readonly at: number; readonly epoch: number; readonly problem: string } | null = null;

  const ask = (path: string, token: string) => Effect.promise(() => githubRequest(apiBase, "GET", path, token));

  // Every installation the user can see and its repositories. The first reply that isn't what's
  // expected ends the look with why.
  const fetchInstalled = Effect.fn("GitHub.fetchInstalled")(function* (token: string) {
    const listed = yield* ask("user/installations?per_page=100", token);
    if (listed.kind === "refused") {
      yield* signedIn.refused(token);
      return { problem: "GitHub refused the sign-in. If this stays, sign in again." } as const;
    }
    const found = listed.kind === "ok" ? decodeInstallations(listed.body) : Option.none();
    if (Option.isNone(found)) return { problem: `Couldn't list where the App is installed${listed.kind === "error" ? `: ${listed.message}` : ""}.` } as const;
    const installations: GitHubInstallation[] = [];
    const repos: string[] = [];
    for (const { id, repository_selection, account, html_url } of found.value.installations) {
      let total = 0;
      for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
        const reply = yield* ask(`user/installations/${id}/repositories?per_page=${REPOS_PER_PAGE}&page=${page}`, token);
        const body = reply.kind === "ok" ? decodeRepositories(reply.body) : Option.none();
        if (Option.isNone(body)) return { problem: "Couldn't list the repositories the App is installed on." } as const;
        total = body.value.total_count;
        // Only names that pass the core's pattern ever go into a request path.
        repos.push(...body.value.repositories.map(({ full_name }) => full_name).filter((name) => REPO_NAME.test(name)));
        if (page * REPOS_PER_PAGE >= total) break;
      }
      installations.push({
        account: account !== null && ACCOUNT.test(account.login) ? account.login : "unknown",
        repositories: repository_selection === "all" ? null : total,
        manageUrl: html_url !== undefined && MANAGE_URL.test(html_url) ? html_url : null,
      });
    }
    return { installed: { installations: installations.toSorted((a, b) => a.account.localeCompare(b.account)), repos: [...new Set(repos)].toSorted() } } as const;
  });

  const reachWithin = (freshMs: number) =>
    looking.withPermits(1)(
      Effect.gen(function* () {
        const { app } = signedIn;
        const token = app === null ? null : yield* signedIn.token;
        if (app === null || token === null) return null;
        const { epoch } = yield* signedIn.status;
        const now = yield* Clock.currentTimeMillis;
        const known = cache !== null && cache.epoch === epoch ? cache : null;
        const last: Installed = known ?? { installations: [], repos: [] };
        if (known !== null && now - known.at < freshMs) return { ...last, app, token, problem: null };
        // The last lists are shown while GitHub can't be asked, with why they weren't refreshed.
        if (failed !== null && failed.epoch === epoch && now - failed.at < RETRY_AFTER_MS) return { ...last, app, token, problem: failed.problem };
        const fetched = yield* fetchInstalled(token);
        if ("installed" in fetched) {
          cache = { ...fetched.installed, at: now, epoch };
          failed = null;
          return { ...fetched.installed, app, token, problem: null };
        }
        failed = { at: now, epoch, problem: fetched.problem };
        return { ...last, app, token, problem: fetched.problem };
      }),
    );

  const status = Effect.fn("GitHub.status")(function* (may: May) {
    const { account, pending, failure } = yield* signedIn.status;
    // A look that failed is said in `problem`, so the account and Sign out still show.
    const reached = account === null ? null : yield* reachWithin(SETTINGS_FRESH_MS).pipe(Effect.catchTag("GitHubError", (error) => Effect.succeed({ installations: [], problem: error.message })));
    // The code signs the server in as whoever types it, so only a session that may sign in is shown it.
    return { app: signedIn.app, account, pending: may.configure ? pending : null, failure, installations: reached?.installations ?? [], problem: reached?.problem ?? null, canConfigure: may.configure };
  });

  return GitHub.of({
    reach: reachWithin(INSTALLED_FRESH_MS),
    status,
    signIn: (may) => signedIn.start.pipe(Effect.andThen(status(may))),
    cancelSignIn: (may) => signedIn.cancel.pipe(Effect.andThen(status(may))),
    signOut: (may) => signedIn.signOut.pipe(Effect.andThen(status(may))),
  });
});

export const layer = Layer.effect(GitHub, make);
