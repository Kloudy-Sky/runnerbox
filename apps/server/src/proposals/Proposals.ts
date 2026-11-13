import { join } from "node:path";
import { type ApplyWhen, type ChangeValue, type Proposal, ProposalError, ProposedChange } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { newId, sha256 } from "../auth/secrets.ts";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { type Described, UpSocket } from "../reproduce/UpSocket.ts";

// Proposed changes to an install's numbers: the agent records one, and only the owner decides it.
// Each is a file in `.server/proposals`, owner-only. Approving sends exactly what was hashed to
// `up`, which checks it all again itself; what happened next is read from `up`'s own change log.

export const EXPIRES_MS = 24 * 60 * 60_000;
export const MAX_OPEN_PER_THREAD = 3;
export const MAX_CHANGES = 20;

const Decision = Schema.Struct({ kind: Schema.Literals(["approved", "declined"]), by: Schema.String, at: Schema.String, when: Schema.NullOr(Schema.Literals(["idle", "now"])) });
const Stored = Schema.Struct({
  v: Schema.Literal(1),
  id: Schema.String,
  install: Schema.String,
  changes: Schema.Array(ProposedChange),
  reason: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  runUrl: Schema.NullOr(Schema.String),
  revertOf: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  hash: Schema.String,
  decision: Schema.NullOr(Decision),
});
type Stored = typeof Stored.Type;
const decodeStored = Schema.decodeUnknownEffect(Schema.fromJsonString(Stored));

// The lines of `up`'s `changes.ndjson` this reads: what became of each approved proposal.
const LogLine = Schema.Struct({ proposalId: Schema.String, outcome: Schema.Literals(["accepted", "applied", "not_applied"]), reason: Schema.optionalKey(Schema.String) });
const decodeLogLine = Schema.decodeUnknownOption(Schema.fromJsonString(LogLine));

export type ProposeInput = {
  readonly threadId: string | null;
  readonly install: string;
  readonly changes: ReadonlyArray<{ readonly path: string; readonly to: ChangeValue }>;
  readonly reason: string;
  readonly runUrl: string | null;
};
export type Approver = { readonly id: string; readonly label: string };

// What's approved, and so what's hashed: the install and each field's previous and next value.
export const proposalHash = (install: string, changes: ReadonlyArray<ProposedChange>) =>
  sha256(JSON.stringify({ install, changes: changes.map(({ path, from, to }) => ({ path, from, to })) }));

export class Proposals extends Context.Service<
  Proposals,
  {
    // The fields a proposal may change on an install, with their values and bounds.
    readonly settings: (install: string) => Effect.Effect<Described, ProposalError>;
    // Records a proposal. It never applies anything.
    readonly propose: (input: ProposeInput) => Effect.Effect<Proposal, ProposalError>;
    readonly list: Effect.Effect<ReadonlyArray<Proposal>, ProposalError>;
    readonly approve: (id: string, hash: string, when: ApplyWhen, by: Approver) => Effect.Effect<Proposal, ProposalError>;
    readonly decline: (id: string, by: Approver) => Effect.Effect<Proposal, ProposalError>;
    // A new proposal that puts back what an applied one changed, to approve like any other.
    readonly revert: (id: string, by: Approver) => Effect.Effect<Proposal, ProposalError>;
  }
>()("runnerbox/server/proposals/Proposals") {}

const show = (value: ChangeValue) => String(value);
const ID = /^[0-9a-f]{16}$/;

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { stateDir, serverDir } = yield* ServerPaths.ServerPaths;
  const up = yield* UpSocket;
  const dir = join(serverDir, "proposals");
  const lock = yield* Semaphore.make(1);
  const unreadable = () => new ProposalError({ why: "Couldn't read or write proposals on the server." });
  const nowIso = Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()));

  const write = (stored: Stored) =>
    fs.makeDirectory(dir, { recursive: true, mode: 0o700 }).pipe(Effect.andThen(writeFileAtomic(fs, join(dir, `${stored.id}.json`), `${JSON.stringify(stored, null, 2)}\n`)), Effect.mapError(unreadable));
  const read = (id: string) =>
    ID.test(id)
      ? fs.readFileString(join(dir, `${id}.json`)).pipe(
          Effect.flatMap(decodeStored),
          Effect.mapError(() => new ProposalError({ why: "No proposal has that ID." })),
        )
      : Effect.fail(new ProposalError({ why: "No proposal has that ID." }));
  const readAll = fs.readDirectory(dir).pipe(
    Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error))),
    Effect.mapError(unreadable),
    Effect.flatMap((names) => Effect.forEach(names.filter((name) => ID.test(name.replace(/\.json$/, ""))), (name) => read(name.replace(/\.json$/, "")).pipe(Effect.option))),
    Effect.map((found) => found.flatMap((entry) => (entry._tag === "Some" ? [entry.value] : []))),
  );

  // `up`'s last word on each proposal it was given, from its change log.
  const outcomes = (install: string) =>
    fs.readFileString(join(stateDir, install, "changes.ndjson")).pipe(
      Effect.map((text) => {
        const last = new Map<string, typeof LogLine.Type>();
        for (const line of text.split("\n")) {
          const entry = decodeLogLine(line);
          if (entry._tag === "Some") last.set(entry.value.proposalId, entry.value);
        }
        return last;
      }),
      Effect.orElseSucceed(() => new Map<string, typeof LogLine.Type>()),
    );

  const view = Effect.fn("Proposals.view")(function* (stored: Stored) {
    const { decision, v: _v, ...fields } = stored;
    const base = { ...fields, decidedBy: decision?.by ?? null, decidedAt: decision?.at ?? null, when: decision?.when ?? null, outcome: null };
    if (decision?.kind === "declined") return { ...base, status: "declined" as const };
    if (decision?.kind === "approved") {
      const outcome = (yield* outcomes(stored.install)).get(stored.id);
      if (outcome?.outcome === "applied") return { ...base, status: "applied" as const };
      if (outcome?.outcome === "not_applied") return { ...base, status: "not_applied" as const, outcome: outcome.reason ?? null };
      return { ...base, status: outcome?.outcome === "accepted" && decision.when === "idle" ? ("waiting" as const) : ("approved" as const) };
    }
    const now = yield* Clock.currentTimeMillis;
    return { ...base, status: Date.parse(stored.expiresAt) <= now ? ("expired" as const) : ("open" as const) } satisfies Proposal;
  });

  const settings = (install: string) => up.describe(install).pipe(Effect.mapError((error) => new ProposalError({ why: error.why })));

  // Fills each change's previous value from `up`, and checks it against `up`'s bounds, so the
  // agent hears at once what `up` would refuse.
  const record = Effect.fn("Proposals.record")(function* (input: ProposeInput & { readonly revertOf: string | null; readonly expect?: ReadonlyArray<ProposedChange> }) {
    if (input.changes.length === 0 || input.changes.length > MAX_CHANGES) return yield* new ProposalError({ why: `A proposal changes 1 to ${MAX_CHANGES} fields.` });
    const { fields } = yield* settings(input.install);
    const changes: ProposedChange[] = [];
    for (const change of input.changes) {
      const field = fields.find((candidate) => candidate.path === change.path);
      if (!field) return yield* new ProposalError({ why: `${change.path} isn't a field a proposal can change. install_settings lists them.` });
      if (changes.some((other) => other.path === change.path)) return yield* new ProposalError({ why: `${change.path} is changed twice.` });
      if (field.value === change.to) return yield* new ProposalError({ why: `${change.path} is already ${show(change.to)}.` });
      changes.push({ path: change.path, from: field.value, to: change.to });
    }
    const expected = input.expect;
    if (expected && expected.some((change) => changes.find((each) => each.path === change.path)?.from !== change.from)) {
      return yield* new ProposalError({ why: "The install's values changed since that change was applied, so it can't be put back as it was." });
    }
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const all = yield* readAll;
        const views = yield* Effect.forEach(all, view);
        if (input.threadId !== null && views.filter((each) => each.threadId === input.threadId && each.status === "open").length >= MAX_OPEN_PER_THREAD) {
          return yield* new ProposalError({ why: `This thread already has ${MAX_OPEN_PER_THREAD} proposals waiting for the owner.` });
        }
        const now = yield* Clock.currentTimeMillis;
        const stored: Stored = {
          v: 1,
          id: newId(),
          install: input.install,
          changes,
          reason: input.reason,
          threadId: input.threadId,
          runUrl: input.runUrl,
          revertOf: input.revertOf,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + EXPIRES_MS).toISOString(),
          hash: proposalHash(input.install, changes),
          decision: null,
        };
        yield* write(stored);
        return yield* view(stored);
      }),
    );
  });

  const propose = (input: ProposeInput) => record({ ...input, revertOf: null });

  const list = Effect.gen(function* () {
    const views = yield* Effect.forEach(yield* readAll, view);
    return views.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  // Decides one open proposal, under the lock, so two decisions can't both land.
  const decide = (id: string, act: (stored: Stored) => Effect.Effect<Stored, ProposalError>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const stored = yield* read(id);
        const current = yield* view(stored);
        if (current.status === "expired") return yield* new ProposalError({ why: "This proposal expired. Ask the agent again if it's still needed." });
        if (current.status !== "open") return yield* new ProposalError({ why: "This proposal was already decided." });
        const decided = yield* act(stored);
        yield* write(decided);
        return yield* view(decided);
      }),
    );

  const approve = (id: string, hash: string, when: ApplyWhen, by: Approver) =>
    decide(id, (stored) =>
      Effect.gen(function* () {
        // Only what the owner saw applies: anything else has another hash.
        if (hash !== stored.hash || proposalHash(stored.install, stored.changes) !== stored.hash) {
          return yield* new ProposalError({ why: "This isn't the proposal you saw. Look at it again before approving." });
        }
        yield* up
          .apply(stored.install, { proposalId: stored.id, hash: stored.hash, approvedBy: { session: by.id, label: by.label }, when, changes: stored.changes })
          .pipe(Effect.mapError((error) => new ProposalError({ why: error.why })));
        return { ...stored, decision: { kind: "approved" as const, by: by.label, at: yield* nowIso, when } };
      }),
    );

  const decline = (id: string, by: Approver) =>
    decide(id, (stored) => nowIso.pipe(Effect.map((at) => ({ ...stored, decision: { kind: "declined" as const, by: by.label, at, when: null } }))));

  const revert = Effect.fn("Proposals.revert")(function* (id: string, _by: Approver) {
    const stored = yield* read(id);
    if ((yield* view(stored)).status !== "applied") return yield* new ProposalError({ why: "Only an applied change can be put back." });
    const back = stored.changes.map(({ path, from, to }) => ({ path, from: to, to: from }));
    return yield* record({
      threadId: stored.threadId,
      install: stored.install,
      changes: back.map(({ path, to }) => ({ path, to })),
      reason: "Puts back the values an earlier change replaced.",
      runUrl: stored.runUrl,
      revertOf: stored.id,
      expect: back,
    });
  });

  return Proposals.of({ settings, propose, list, approve, decline, revert });
});

export const layer = Layer.effect(Proposals, make);
