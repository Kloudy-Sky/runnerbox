import { join } from "node:path";
import {
  AccessError,
  AuthScope,
  MCP_SCOPES,
  type PairingCode,
  SessionAudience,
  type SessionSummary,
} from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { newId, newPairingCode, newToken, normalizeCode, sha256 } from "./secrets.ts";

export class AuthStoreError extends Schema.TaggedError<AuthStoreError>()("AuthStoreError", {
  operation: Schema.Literals(["read", "write"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Couldn't ${this.operation} the server's auth file.`;
  }
}

export class PairingRejected extends Schema.TaggedError<PairingRejected>()("PairingRejected", {}) {
  override get message() {
    return "That pairing code is wrong, used or expired.";
  }
}

// Only hashes are stored, so reading this file gives nobody a working code or token.
const StoredSession = Schema.Struct({
  id: Schema.String,
  tokenHash: Schema.String,
  label: Schema.String,
  audience: SessionAudience,
  scopes: Schema.Array(AuthScope),
  createdAt: Schema.String,
  lastSeenAt: Schema.NullOr(Schema.String),
  // Set for a session bought with a Connect credential: every use must carry a DPoP proof from
  // the key with this thumbprint.
  proofKeyThumbprint: Schema.optionalKey(Schema.String),
  // Key-bound sessions and a thread turn's MCP token expire; others last until revoked.
  expiresAt: Schema.optionalKey(Schema.String),
});
const StoredCode = Schema.Struct({
  codeHash: Schema.String,
  scopes: Schema.Array(AuthScope),
  expiresAt: Schema.String,
  proofKeyThumbprint: Schema.optionalKey(Schema.String),
});
const AuthFile = Schema.Struct({
  v: Schema.Literal(1),
  codes: Schema.Array(StoredCode),
  sessions: Schema.Array(StoredSession),
  // One-time IDs already used (relay proofs, DPoP proofs), until they'd have expired anyway.
  used: Schema.optionalKey(Schema.Array(Schema.Struct({ key: Schema.String, expiresAt: Schema.Number }))),
});
type AuthFile = typeof AuthFile.Type;
const decodeAuthFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AuthFile));

// Which listener a request came in on. `tunnel` is the one only `cloudflared` points at, which
// accepts key-bound Connect credentials and sessions and nothing else.
export type Entry = "local" | "tunnel";

export type Session = Pick<typeof StoredSession.Type, "id" | "label" | "audience" | "scopes" | "proofKeyThumbprint">;

// A credential bound to a proof key never buys more than reading, whoever asked for it.
const PROOF_BOUND_SCOPES: ReadonlyArray<AuthScope> = MCP_SCOPES;

const CODE_TTL_MS = 15 * 60_000;
const TICKET_TTL_MS = 30_000;
// Recording every request would rewrite the file on each call, so last-seen is coarse.
const SEEN_RESOLUTION_MS = 60_000;
// A Connect session lasts long enough to open its socket and reconnect for a while. Each new
// connection mints another, so a failing reconnect loop can't pile up sessions that last forever.
const KEY_BOUND_SESSION_TTL_MS = 60 * 60_000;
const unexpired = (now: number) => (session: { expiresAt?: string }) => session.expiresAt === undefined || Date.parse(session.expiresAt) > now;

// Pairing codes, sessions and WebSocket tickets. The file is shared with `pair` and `mcp-token`
// run as separate processes, so it's read again on every check rather than cached.
export class AuthStore extends Context.Service<
  AuthStore,
  {
    readonly createPairingCode: (
      scopes: ReadonlyArray<AuthScope>,
      options?: { readonly proofKeyThumbprint?: string; readonly ttlMs?: number },
    ) => Effect.Effect<PairingCode, AuthStoreError>;
    // A session can hand on only scopes it holds itself.
    readonly delegatePairingCode: (
      session: Session,
      scopes: ReadonlyArray<AuthScope>,
    ) => Effect.Effect<PairingCode, AuthStoreError | AccessError>;
    // `proofKeyThumbprint` is the key that signed the request's DPoP proof, if it had one.
    readonly pair: (input: {
      readonly code: string;
      readonly label: string;
      readonly proofKeyThumbprint?: string | undefined;
      // Refuses a code that isn't bound to a key, leaving it unspent for its owner.
      readonly keyBoundOnly?: boolean;
    }) => Effect.Effect<{ readonly token: string; readonly session: Session }, AuthStoreError | PairingRejected>;
    // `ttlMs` makes the token expire on its own, for one that should be revoked but might not be.
    readonly mintMcpToken: (label: string, options?: { readonly ttlMs?: number }) => Effect.Effect<{ readonly token: string; readonly session: Session }, AuthStoreError>;
    readonly authenticate: (
      token: string,
      audience: SessionAudience,
      proofKeyThumbprint?: string | undefined,
    ) => Effect.Effect<Session | undefined, AuthStoreError>;
    // True the first time `key` is seen before `expiresAt`, false on a replay.
    readonly consumeOnce: (key: string, expiresAt: number) => Effect.Effect<boolean, AuthStoreError>;
    // A ticket opens a socket only on the listener it was issued on.
    readonly issueTicket: (session: Session, entry: Entry) => Effect.Effect<{ readonly ticket: string; readonly expiresAt: string }>;
    readonly redeemTicket: (ticket: string, entry: Entry) => Effect.Effect<Session | undefined, AuthStoreError>;
    readonly list: (currentId: string) => Effect.Effect<ReadonlyArray<SessionSummary>, AuthStoreError>;
    readonly revoke: (id: string) => Effect.Effect<void, AuthStoreError | AccessError>;
    // Completes when this server revokes the session, so whatever it opened can be closed.
    readonly revoked: (sessionId: string) => Effect.Effect<void>;
  }
>()("runnerbox/server/AuthStore") {}

// A client session paired by address or SSH with `access:write` was given everything the server
// offered, so it also gets scopes added since, which today is `threads:operate`. The owner chose
// this widening. Stored scopes never change, so an older server reads the file as before; MCP
// tokens and Connect (key-bound) sessions get nothing extra.
const effectiveScopes = ({ audience, scopes, proofKeyThumbprint }: typeof StoredSession.Type): ReadonlyArray<AuthScope> =>
  audience === "client" && proofKeyThumbprint === undefined && scopes.includes("access:write") && !scopes.includes("threads:operate")
    ? [...scopes, "threads:operate"]
    : scopes;

const toSession = (stored: typeof StoredSession.Type): Session => ({
  id: stored.id,
  label: stored.label,
  audience: stored.audience,
  scopes: effectiveScopes(stored),
  ...(stored.proofKeyThumbprint === undefined ? {} : { proofKeyThumbprint: stored.proofKeyThumbprint }),
});

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const path = join(serverDir, "auth.json");
  const lock = yield* Semaphore.make(1);
  // Tickets are short and single-use, and die with the process, so they never touch disk.
  const tickets = new Map<string, { sessionId: string; expiresAt: number; entry: Entry }>();
  // Sockets waiting to hear their session was revoked, by session ID.
  const watchers = new Map<string, Set<Deferred.Deferred<void>>>();

  const read = fs.readFileString(path).pipe(
    Effect.catchTag("PlatformError", (error) =>
      error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
    ),
    Effect.flatMap((text): Effect.Effect<AuthFile, unknown> =>
      text === "" ? Effect.succeed({ v: 1, codes: [], sessions: [] }) : decodeAuthFile(text),
    ),
    Effect.mapError((cause) => new AuthStoreError({ operation: "read", cause })),
  );

  // The file as of now, without sessions that have expired but not yet been pruned.
  const readLive = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const file = yield* read;
    return { ...file, sessions: file.sessions.filter(unexpired(now)) };
  });

  const write = (file: AuthFile) =>
    fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify(file, null, 2)}\n`)),
      Effect.mapError((cause) => new AuthStoreError({ operation: "write", cause })),
    );

  // Read, change and write under one lock, dropping expired codes on the way.
  const update = <A, E>(change: (file: AuthFile, now: number) => Effect.Effect<readonly [AuthFile, A], E>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const current = yield* read;
        const live = {
          ...current,
          codes: current.codes.filter((code) => Date.parse(code.expiresAt) > now),
          used: (current.used ?? []).filter((entry) => entry.expiresAt > now),
          sessions: current.sessions.filter(unexpired(now)),
        };
        const [next, result] = yield* change(live, now);
        yield* write(next);
        return result;
      }),
    );

  const addSession = (file: AuthFile, now: number, fields: Omit<typeof StoredSession.Type, "id" | "tokenHash" | "createdAt" | "lastSeenAt">) => {
    const token = newToken();
    const stored = { ...fields, id: newId(), tokenHash: sha256(token), createdAt: new Date(now).toISOString(), lastSeenAt: null };
    return [{ ...file, sessions: [...file.sessions, stored] }, { token, session: toSession(stored) }] as const;
  };

  const createPairingCode = Effect.fn("AuthStore.createPairingCode")(function* (
    scopes: ReadonlyArray<AuthScope>,
    options: { readonly proofKeyThumbprint?: string; readonly ttlMs?: number } = {},
  ) {
    const code = newPairingCode();
    return yield* update((file, now) => {
      const expiresAt = new Date(now + (options.ttlMs ?? CODE_TTL_MS)).toISOString();
      const bound = options.proofKeyThumbprint;
      const stored = {
        codeHash: sha256(normalizeCode(code)),
        scopes: [...new Set(scopes)].filter((scope) => bound === undefined || PROOF_BOUND_SCOPES.includes(scope)),
        expiresAt,
        ...(bound === undefined ? {} : { proofKeyThumbprint: bound }),
      };
      return Effect.succeed([{ ...file, codes: [...file.codes, stored] }, { code, scopes: stored.scopes, expiresAt }] as const);
    });
  });

  const delegatePairingCode = Effect.fn("AuthStore.delegatePairingCode")(function* (
    session: Session,
    scopes: ReadonlyArray<AuthScope>,
  ) {
    if (!scopes.every((scope) => session.scopes.includes(scope))) return yield* new AccessError({ reason: "scope_not_held" });
    // A socket keeps the session it opened with, so check it hasn't been revoked since.
    if (!(yield* readLive).sessions.some((stored) => stored.id === session.id)) return yield* new AccessError({ reason: "unknown_session" });
    return yield* createPairingCode(scopes);
  });

  const pair = Effect.fn("AuthStore.pair")(function* (input: {
    readonly code: string;
    readonly label: string;
    readonly proofKeyThumbprint?: string | undefined;
    readonly keyBoundOnly?: boolean;
  }) {
    const codeHash = sha256(normalizeCode(input.code));
    return yield* update((file, now) => {
      const grant = file.codes.find((code) => code.codeHash === codeHash);
      if (!grant || (input.keyBoundOnly && grant.proofKeyThumbprint === undefined)) return Effect.fail(new PairingRejected());
      // A bound code is useless without its key: a wrong key leaves it unspent for its owner.
      if (grant.proofKeyThumbprint !== undefined && grant.proofKeyThumbprint !== input.proofKeyThumbprint) return Effect.fail(new PairingRejected());
      const spent = { ...file, codes: file.codes.filter((code) => code !== grant) };
      return Effect.succeed(
        addSession(spent, now, {
          label: input.label || "client",
          audience: "client",
          scopes: grant.proofKeyThumbprint === undefined ? grant.scopes : grant.scopes.filter((scope) => PROOF_BOUND_SCOPES.includes(scope)),
          ...(grant.proofKeyThumbprint === undefined
            ? {}
            : { proofKeyThumbprint: grant.proofKeyThumbprint, expiresAt: new Date(now + KEY_BOUND_SESSION_TTL_MS).toISOString() }),
        }),
      );
    });
  });

  const mintMcpToken = Effect.fn("AuthStore.mintMcpToken")(function* (label: string, options: { readonly ttlMs?: number } = {}) {
    return yield* update((file, now) =>
      Effect.succeed(
        addSession(file, now, {
          label,
          audience: "mcp",
          scopes: MCP_SCOPES,
          ...(options.ttlMs === undefined ? {} : { expiresAt: new Date(now + options.ttlMs).toISOString() }),
        }),
      ),
    );
  });

  const authenticate = Effect.fn("AuthStore.authenticate")(function* (
    token: string,
    audience: SessionAudience,
    proofKeyThumbprint?: string | undefined,
  ) {
    const tokenHash = sha256(token);
    const found = (yield* readLive).sessions.find((session) => session.tokenHash === tokenHash);
    if (!found || found.audience !== audience) return undefined;
    if (found.proofKeyThumbprint !== undefined && found.proofKeyThumbprint !== proofKeyThumbprint) return undefined;
    const now = yield* Clock.currentTimeMillis;
    if (found.lastSeenAt === null || now - Date.parse(found.lastSeenAt) > SEEN_RESOLUTION_MS) {
      const seen = new Date(now).toISOString();
      yield* update((file) =>
        Effect.succeed([
          { ...file, sessions: file.sessions.map((session) => (session.id === found.id ? { ...session, lastSeenAt: seen } : session)) },
          undefined,
        ] as const),
      );
    }
    return toSession(found);
  });

  const consumeOnce = Effect.fn("AuthStore.consumeOnce")(function* (key: string, expiresAt: number) {
    return yield* update((file) =>
      (file.used ?? []).some((entry) => entry.key === sha256(key))
        ? Effect.succeed([file, false] as const)
        : Effect.succeed([{ ...file, used: [...(file.used ?? []), { key: sha256(key), expiresAt }] }, true] as const),
    );
  });

  const issueTicket = Effect.fn("AuthStore.issueTicket")(function* (session: Session, entry: Entry) {
    const now = yield* Clock.currentTimeMillis;
    for (const [ticket, issued] of tickets) if (issued.expiresAt <= now) tickets.delete(ticket);
    const ticket = newToken();
    tickets.set(sha256(ticket), { sessionId: session.id, expiresAt: now + TICKET_TTL_MS, entry });
    return { ticket, expiresAt: new Date(now + TICKET_TTL_MS).toISOString() };
  });

  // Looks the session up again, so a ticket issued just before a revoke opens nothing.
  const redeemTicket = Effect.fn("AuthStore.redeemTicket")(function* (ticket: string, entry: Entry) {
    const key = sha256(ticket);
    const issued = tickets.get(key);
    tickets.delete(key);
    const now = yield* Clock.currentTimeMillis;
    if (!issued || issued.expiresAt <= now || issued.entry !== entry) return undefined;
    const found = (yield* readLive).sessions.find((session) => session.id === issued.sessionId);
    return found ? toSession(found) : undefined;
  });

  const list = Effect.fn("AuthStore.list")(function* (currentId: string) {
    return (yield* readLive).sessions.map((stored) => ({
      id: stored.id,
      label: stored.label,
      audience: stored.audience,
      scopes: effectiveScopes(stored),
      createdAt: stored.createdAt,
      lastSeenAt: stored.lastSeenAt,
      current: stored.id === currentId,
    }));
  });

  const revoke = Effect.fn("AuthStore.revoke")(function* (id: string) {
    yield* update((file) =>
      file.sessions.some((session) => session.id === id)
        ? Effect.succeed([{ ...file, sessions: file.sessions.filter((session) => session.id !== id) }, undefined] as const)
        : Effect.fail(new AccessError({ reason: "unknown_session" })),
    );
    for (const watcher of watchers.get(id) ?? []) yield* Deferred.succeed(watcher, undefined);
    watchers.delete(id);
  });

  const revoked = (sessionId: string) =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        const watcher = yield* Deferred.make<void>();
        watchers.set(sessionId, (watchers.get(sessionId) ?? new Set()).add(watcher));
        return watcher;
      }),
      // A revoke that landed before the watcher was added finds no watcher, so check again after
      // adding it. A file that can't be read counts as revoked: the socket closes.
      (watcher) =>
        readLive.pipe(
          Effect.map((file) => file.sessions.some((session) => session.id === sessionId)),
          Effect.orElseSucceed(() => false),
          Effect.flatMap((live) => (live ? Deferred.await(watcher) : Effect.void)),
        ),
      (watcher) => Effect.sync(() => void watchers.get(sessionId)?.delete(watcher)),
    );

  return AuthStore.of({ createPairingCode, delegatePairingCode, pair, mintMcpToken, authenticate, consumeOnce, issueTicket, redeemTicket, list, revoke, revoked });
});

export const layer = Layer.effect(AuthStore, make);
