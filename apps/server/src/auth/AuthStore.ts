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
});
const StoredCode = Schema.Struct({ codeHash: Schema.String, scopes: Schema.Array(AuthScope), expiresAt: Schema.String });
const AuthFile = Schema.Struct({
  v: Schema.Literal(1),
  codes: Schema.Array(StoredCode),
  sessions: Schema.Array(StoredSession),
});
type AuthFile = typeof AuthFile.Type;
const decodeAuthFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AuthFile));

export type Session = Pick<typeof StoredSession.Type, "id" | "label" | "audience" | "scopes">;

const CODE_TTL_MS = 15 * 60_000;
const TICKET_TTL_MS = 30_000;
// Recording every request would rewrite the file on each call, so last-seen is coarse.
const SEEN_RESOLUTION_MS = 60_000;

// Pairing codes, sessions and WebSocket tickets. The file is shared with `pair` and `mcp-token`
// run as separate processes, so it's read again on every check rather than cached.
export class AuthStore extends Context.Service<
  AuthStore,
  {
    readonly createPairingCode: (scopes: ReadonlyArray<AuthScope>) => Effect.Effect<PairingCode, AuthStoreError>;
    // A session can hand on only scopes it holds itself.
    readonly delegatePairingCode: (
      session: Session,
      scopes: ReadonlyArray<AuthScope>,
    ) => Effect.Effect<PairingCode, AuthStoreError | AccessError>;
    readonly pair: (input: {
      readonly code: string;
      readonly label: string;
    }) => Effect.Effect<{ readonly token: string; readonly session: Session }, AuthStoreError | PairingRejected>;
    readonly mintMcpToken: (label: string) => Effect.Effect<{ readonly token: string; readonly session: Session }, AuthStoreError>;
    readonly authenticate: (token: string, audience: SessionAudience) => Effect.Effect<Session | undefined, AuthStoreError>;
    readonly issueTicket: (session: Session) => Effect.Effect<{ readonly ticket: string; readonly expiresAt: string }>;
    readonly redeemTicket: (ticket: string) => Effect.Effect<Session | undefined, AuthStoreError>;
    readonly list: (currentId: string) => Effect.Effect<ReadonlyArray<SessionSummary>, AuthStoreError>;
    readonly revoke: (id: string) => Effect.Effect<void, AuthStoreError | AccessError>;
  }
>()("runnerbox/server/AuthStore") {}

const toSession = ({ id, label, audience, scopes }: typeof StoredSession.Type): Session => ({ id, label, audience, scopes });

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const path = join(serverDir, "auth.json");
  const lock = yield* Semaphore.make(1);
  // Tickets are short and single-use, and die with the process, so they never touch disk.
  const tickets = new Map<string, { sessionId: string; expiresAt: number }>();

  const read = fs.readFileString(path).pipe(
    Effect.catchTag("PlatformError", (error) =>
      error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
    ),
    Effect.flatMap((text): Effect.Effect<AuthFile, unknown> =>
      text === "" ? Effect.succeed({ v: 1, codes: [], sessions: [] }) : decodeAuthFile(text),
    ),
    Effect.mapError((cause) => new AuthStoreError({ operation: "read", cause })),
  );

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
        const live = { ...current, codes: current.codes.filter((code) => Date.parse(code.expiresAt) > now) };
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

  const createPairingCode = Effect.fn("AuthStore.createPairingCode")(function* (scopes: ReadonlyArray<AuthScope>) {
    const code = newPairingCode();
    return yield* update((file, now) => {
      const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
      const stored = { codeHash: sha256(normalizeCode(code)), scopes: [...new Set(scopes)], expiresAt };
      return Effect.succeed([{ ...file, codes: [...file.codes, stored] }, { code, scopes: stored.scopes, expiresAt }] as const);
    });
  });

  const delegatePairingCode = Effect.fn("AuthStore.delegatePairingCode")(function* (
    session: Session,
    scopes: ReadonlyArray<AuthScope>,
  ) {
    if (!scopes.every((scope) => session.scopes.includes(scope))) return yield* new AccessError({ reason: "scope_not_held" });
    return yield* createPairingCode(scopes);
  });

  const pair = Effect.fn("AuthStore.pair")(function* (input: { readonly code: string; readonly label: string }) {
    const codeHash = sha256(normalizeCode(input.code));
    return yield* update((file, now) => {
      const grant = file.codes.find((code) => code.codeHash === codeHash);
      if (!grant) return Effect.fail(new PairingRejected());
      const spent = { ...file, codes: file.codes.filter((code) => code !== grant) };
      return Effect.succeed(addSession(spent, now, { label: input.label || "client", audience: "client", scopes: grant.scopes }));
    });
  });

  const mintMcpToken = Effect.fn("AuthStore.mintMcpToken")(function* (label: string) {
    return yield* update((file, now) => Effect.succeed(addSession(file, now, { label, audience: "mcp", scopes: MCP_SCOPES })));
  });

  const authenticate = Effect.fn("AuthStore.authenticate")(function* (token: string, audience: SessionAudience) {
    const tokenHash = sha256(token);
    const found = (yield* read).sessions.find((session) => session.tokenHash === tokenHash);
    if (!found || found.audience !== audience) return undefined;
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

  const issueTicket = Effect.fn("AuthStore.issueTicket")(function* (session: Session) {
    const now = yield* Clock.currentTimeMillis;
    for (const [ticket, entry] of tickets) if (entry.expiresAt <= now) tickets.delete(ticket);
    const ticket = newToken();
    tickets.set(sha256(ticket), { sessionId: session.id, expiresAt: now + TICKET_TTL_MS });
    return { ticket, expiresAt: new Date(now + TICKET_TTL_MS).toISOString() };
  });

  // Looks the session up again, so a ticket issued just before a revoke opens nothing.
  const redeemTicket = Effect.fn("AuthStore.redeemTicket")(function* (ticket: string) {
    const key = sha256(ticket);
    const entry = tickets.get(key);
    tickets.delete(key);
    const now = yield* Clock.currentTimeMillis;
    if (!entry || entry.expiresAt <= now) return undefined;
    const found = (yield* read).sessions.find((session) => session.id === entry.sessionId);
    return found ? toSession(found) : undefined;
  });

  const list = Effect.fn("AuthStore.list")(function* (currentId: string) {
    return (yield* read).sessions.map(({ id, label, audience, scopes, createdAt, lastSeenAt }) => ({
      id,
      label,
      audience,
      scopes,
      createdAt,
      lastSeenAt,
      current: id === currentId,
    }));
  });

  const revoke = Effect.fn("AuthStore.revoke")(function* (id: string) {
    yield* update((file) =>
      file.sessions.some((session) => session.id === id)
        ? Effect.succeed([{ ...file, sessions: file.sessions.filter((session) => session.id !== id) }, undefined] as const)
        : Effect.fail(new AccessError({ reason: "unknown_session" })),
    );
  });

  return AuthStore.of({ createPairingCode, delegatePairingCode, pair, mintMcpToken, authenticate, issueTicket, redeemTicket, list, revoke });
});

export const layer = Layer.effect(AuthStore, make);
