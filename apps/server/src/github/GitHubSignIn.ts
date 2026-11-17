import { join } from "node:path";
import { type GitHubAppName, GitHubError, type GitHubSignInFailure, type GitHubSignInPrompt } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import { githubRequest } from "./githubRequest.ts";

// The server's sign-in to GitHub as its owner, through the Runnerbox GitHub App's device flow: the
// owner types a code on GitHub, and GitHub hands the server a token for that user. The flow needs
// only the App's public client ID, so no secret or private key exists here or anywhere. The token
// and the one that renews it are kept in `.server/github-session.json`, owner-only. They're never
// returned over RPC, logged, given to an agent or put in a thread, and are sent only to GitHub.

const Session = Schema.Struct({
  v: Schema.Literal(1),
  account: Schema.String,
  accessToken: Schema.String,
  // Null when the App hands out tokens that don't expire.
  accessTokenExpiresAt: Schema.NullOr(Schema.Number),
  refreshToken: Schema.NullOr(Schema.String),
  refreshTokenExpiresAt: Schema.NullOr(Schema.Number),
});
type Session = typeof Session.Type;
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(Session));

// GitHub's replies are outside input: only these fields are read. It answers both grants with HTTP
// 200 and puts a refusal in `error`.
const decodeDevice = Schema.decodeUnknownOption(Schema.Struct({ device_code: Schema.String, user_code: Schema.String, verification_uri: Schema.String, expires_in: Schema.Number, interval: Schema.optionalKey(Schema.Number) }));
const decodeGrant = Schema.decodeUnknownOption(
  Schema.Struct({
    access_token: Schema.optionalKey(Schema.String),
    expires_in: Schema.optionalKey(Schema.Number),
    refresh_token: Schema.optionalKey(Schema.String),
    refresh_token_expires_in: Schema.optionalKey(Schema.Number),
    interval: Schema.optionalKey(Schema.Number),
    error: Schema.optionalKey(Schema.String),
  }),
);
const decodeViewer = Schema.decodeUnknownOption(Schema.Struct({ login: Schema.String }));

const GITHUB = "https://github.com";
const TIMEOUT_MS = 15_000;
// A token this close to its end is renewed before it's handed out, so it lasts through a long request.
const REFRESH_MARGIN_MS = 5 * 60_000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const USER_CODE = /^[A-Z0-9-]{4,20}$/;
const LOGIN = /^[\w-]{1,60}$/;

type Pending = { readonly prompt: GitHubSignInPrompt; readonly fiber: Fiber.Fiber<void> };

export class GitHubSignIn extends Context.Service<
  GitHubSignIn,
  {
    // The App this server signs in through, or null when it has no client ID.
    readonly app: GitHubAppName | null;
    // `epoch` changes whenever the signed-in user may have, so what was read as one isn't shown for another.
    readonly status: Effect.Effect<{ readonly account: string | null; readonly pending: GitHubSignInPrompt | null; readonly failure: GitHubSignInFailure | null; readonly epoch: number }, GitHubError>;
    // Asks GitHub for a code and waits in the background for the owner to approve it. A sign-in already waiting is dropped.
    readonly start: Effect.Effect<void, GitHubError>;
    readonly cancel: Effect.Effect<void>;
    // Forgets the tokens. GitHub lists the authorization until the owner revokes it there.
    readonly signOut: Effect.Effect<void, GitHubError>;
    // The signed-in user's token, renewed when it's due. Null when signed out.
    readonly token: Effect.Effect<string | null, GitHubError>;
    // Told GitHub refused `token`, so the next `token` renews it before handing it out again.
    readonly refused: (token: string) => Effect.Effect<void>;
  }
>()("runnerbox/server/github/GitHubSignIn") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const config = yield* QueueConfig;
  const scope = yield* Effect.scope;
  const app = config.app ?? null;
  const loginBase = config.loginBase ?? GITHUB;
  const path = join(serverDir, "github-session.json");
  const unreadable = () => new GitHubError({ reason: "unreadable" });
  // One change to the session at a time, so two requests renew a token once and a sign-out isn't undone by a renewal.
  const lock = yield* Semaphore.make(1);
  // What the file holds, once it's been read.
  let session: Session | null | undefined;
  let pending: Pending | null = null;
  let failure: GitHubSignInFailure | null = null;
  let refusedToken: string | null = null;
  let epoch = 0;

  // A token endpoint that redirects is misconfigured or hostile, so the redirect isn't followed.
  const post = (pathname: string, form: Record<string, string>) =>
    Effect.promise(async (): Promise<unknown> => {
      try {
        const response = await fetch(`${loginBase}${pathname}`, { method: "POST", body: new URLSearchParams(form), redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        return await response.json();
      } catch {
        return null;
      }
    });

  const current = Effect.suspend(() =>
    session !== undefined
      ? Effect.succeed(session)
      : fs.readFileString(path).pipe(
          Effect.map(Option.some),
          Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(Option.none<string>()) : Effect.fail(error))),
          Effect.flatMap((text) => (Option.isSome(text) ? decodeFile(text.value) : Effect.succeed(null))),
          Effect.mapError(unreadable),
          Effect.tap((read) => Effect.sync(() => void (session = read))),
        ),
  );
  const keep = (next: Session) =>
    Effect.suspend(() => {
      session = next;
      refusedToken = null;
      return fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify(next)}\n`)), Effect.mapError(unreadable));
    });
  const forget = fs.remove(path, { force: true }).pipe(
    Effect.mapError(unreadable),
    Effect.andThen(
      Effect.sync(() => {
        session = null;
        refusedToken = null;
        epoch += 1;
      }),
    ),
  );

  const granted = (grant: { readonly access_token: string; readonly expires_in?: number; readonly refresh_token?: string; readonly refresh_token_expires_in?: number }, account: string, now: number): Session => ({
    v: 1,
    account,
    accessToken: grant.access_token,
    accessTokenExpiresAt: grant.expires_in === undefined ? null : now + grant.expires_in * 1000,
    refreshToken: grant.refresh_token ?? null,
    refreshTokenExpiresAt: grant.refresh_token_expires_in === undefined ? null : now + grant.refresh_token_expires_in * 1000,
  });

  const token = lock.withPermits(1)(
    Effect.gen(function* () {
      const held = yield* current;
      if (held === null) return null;
      const now = yield* Clock.currentTimeMillis;
      const refused = held.accessToken === refusedToken;
      if (!refused && (held.accessTokenExpiresAt === null || held.accessTokenExpiresAt - now > REFRESH_MARGIN_MS)) return held.accessToken;
      // Still good for the minutes it has left, when it can't be renewed right now.
      const usable = !refused && (held.accessTokenExpiresAt === null || held.accessTokenExpiresAt > now) ? held.accessToken : null;
      if (app === null) return usable;
      const refreshToken = held.refreshTokenExpiresAt === null || held.refreshTokenExpiresAt > now ? held.refreshToken : null;
      const grant = refreshToken === null ? undefined : Option.getOrUndefined(decodeGrant(yield* post("/login/oauth/access_token", { client_id: app.clientId, grant_type: "refresh_token", refresh_token: refreshToken })));
      if (grant?.access_token !== undefined) {
        // GitHub has retired the old pair, so the new one is used even when it couldn't be written down.
        yield* keep(granted({ ...grant, access_token: grant.access_token }, held.account, now)).pipe(Effect.ignore);
        return grant.access_token;
      }
      // GitHub turned the renewal down, as when the owner revoked the App, or the sign-in ran out:
      // there's nothing left to renew with, so the server signs out once the token it has ends.
      if (refreshToken === null || grant?.error !== undefined) {
        if (usable !== null) return usable;
        yield* forget;
        return null;
      }
      // No answer came, so the next ask tries again.
      return usable ?? (yield* new GitHubError({ reason: "github_unreachable" }));
    }),
  );

  // Asks GitHub every `interval` seconds whether the code was approved, until it says how the sign-in ended.
  const poll = (deviceCode: string, expiresAt: number, interval: number, clientId: string) =>
    Effect.gen(function* () {
      let wait = interval;
      while (true) {
        yield* Effect.sleep(wait * 1000);
        if ((yield* Clock.currentTimeMillis) >= expiresAt) return "expired" as const;
        const reply = decodeGrant(yield* post("/login/oauth/access_token", { client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT }));
        // A poll that got no answer is tried again; the code stays good until it expires.
        if (Option.isNone(reply)) continue;
        const grant = reply.value;
        if (grant.access_token !== undefined) {
          const viewer = yield* Effect.promise(() => githubRequest(config.apiBase, "GET", "user", grant.access_token ?? ""));
          const login = viewer.kind === "ok" ? Option.getOrUndefined(decodeViewer(viewer.body))?.login : undefined;
          if (login === undefined || !LOGIN.test(login)) return "failed" as const;
          const now = yield* Clock.currentTimeMillis;
          const kept = yield* lock.withPermits(1)(keep(granted({ ...grant, access_token: grant.access_token }, login, now)).pipe(Effect.tap(() => Effect.sync(() => void (epoch += 1))))).pipe(Effect.exit);
          return kept._tag === "Success" ? null : ("failed" as const);
        }
        if (grant.error === "authorization_pending") continue;
        if (grant.error === "slow_down") wait = grant.interval ?? wait + 5;
        else return grant.error === "expired_token" ? ("expired" as const) : grant.error === "access_denied" ? ("denied" as const) : ("failed" as const);
      }
    });

  // One start or cancel at a time, so two starts together can't both fork a poll and leave one
  // that nothing can cancel.
  const starting = yield* Semaphore.make(1);
  const dropPending = Effect.suspend(() => {
    const waiting = pending;
    pending = null;
    return waiting === null ? Effect.void : Fiber.interrupt(waiting.fiber);
  });
  const cancel = starting.withPermits(1)(dropPending);

  const begin = Effect.gen(function* () {
    if (app === null) return yield* new GitHubError({ reason: "not_configured" });
    yield* dropPending;
    const answer = yield* post("/login/device/code", { client_id: app.clientId });
    // The one refusal the owner can fix: the App's settings on GitHub have the device flow off.
    if (Option.getOrUndefined(decodeGrant(answer))?.error === "device_flow_disabled") return yield* new GitHubError({ reason: "device_flow_disabled" });
    const reply = decodeDevice(answer);
    // The address is shown as a link, so it's only taken when it's on the host that was asked.
    if (Option.isNone(reply) || !USER_CODE.test(reply.value.user_code) || !reply.value.verification_uri.startsWith(`${loginBase}/`)) return yield* new GitHubError({ reason: "github_unreachable" });
    const { device_code, user_code, verification_uri, expires_in, interval } = reply.value;
    const expiresAt = (yield* Clock.currentTimeMillis) + expires_in * 1000;
    const prompt: GitHubSignInPrompt = { userCode: user_code, verificationUri: verification_uri, expiresAt: new Date(expiresAt).toISOString() };
    failure = null;
    // Only the sign-in still waiting says how it ended: one that was replaced or cancelled says nothing.
    const fiber: Fiber.Fiber<void> = yield* poll(device_code, expiresAt, interval ?? 5, app.clientId).pipe(
      Effect.flatMap((outcome) =>
        Effect.sync(() => {
          if (pending?.prompt !== prompt) return;
          pending = null;
          failure = outcome;
        }),
      ),
      Effect.forkIn(scope),
    );
    pending = { prompt, fiber };
  });
  const start = starting.withPermits(1)(begin);

  const status = current.pipe(Effect.map((held) => ({ account: held?.account ?? null, pending: pending?.prompt ?? null, failure, epoch })));
  const signOut = cancel.pipe(Effect.andThen(lock.withPermits(1)(forget)));
  const refused = (refusedNow: string) => Effect.sync(() => void (refusedToken = refusedNow));

  return GitHubSignIn.of({ app: app === null ? null : { slug: app.slug, name: app.name }, status, start, cancel, signOut, token, refused });
});

export const layer = Layer.effect(GitHubSignIn, make);
