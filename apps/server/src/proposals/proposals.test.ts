import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createProof, createProofKey } from "@runnerbox/connect/dpop";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, type ThreadItem } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { startFakeUp } from "../testing/fakeUp.ts";
import { type FakeStep, makeFakeProvider } from "../testing/FakeProvider.ts";
import { writeFixtures } from "../testing/fixtures.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Up = Awaited<ReturnType<typeof startFakeUp>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

const ITEM = "failure:owner/name\u0000ci\u0000test:infra";
const PROPOSE: FakeStep = { tool: "propose_change", input: { install: "example", changes: [{ path: "runners.linux.slots", to: 2 }], reason: "The VM ran short of memory with one slot busy; this is the other way round." } };

// A short state directory, since the control socket's whole path must fit in about 100 characters.
async function withProposals(turns: ReadonlyArray<ReadonlyArray<FakeStep>>, use: (server: Server, up: Up, fake: ReturnType<typeof makeFakeProvider>) => Promise<void>) {
  const stateDir = await mkdtemp(join(tmpdir(), "rbx-"));
  await writeFixtures(stateDir, Date.now());
  const fake = makeFakeProvider({ turns });
  const server = await startTestServer({ stateDir, provider: fake });
  const up = await startFakeUp(join(stateDir, "example"));
  try {
    await use(server, up, fake);
  } finally {
    await up.close();
    await server.close(false);
    await rm(stateDir, { recursive: true, force: true });
  }
}

const session = async (server: Server, scopes: ReadonlyArray<AuthScope> = ALL_SCOPES) => {
  const { code } = await server.createPairingCode(scopes);
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, "desktop"))).token;
};
const withClient = <A, E>(server: Server, token: string, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));

// Asks a question in a new thread on the fixtures' failure and waits for the turn to end.
const askInThread = (client: Client) =>
  Effect.gen(function* () {
    const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
    const done = yield* client["threads.subscribe"]({ id: thread.id }).pipe(Stream.drop(1), Stream.takeUntil((event) => event._tag === "TurnEnded"), Stream.runDrain, Effect.forkChild);
    yield* Effect.sleep(50);
    yield* client["threads.startTurn"]({ id: thread.id, text: "Fix it." });
    yield* Fiber.join(done);
    return thread.id;
  });

const threadLog = async (server: Server, id: string) =>
  (await readFile(join(server.stateDir, ".server", "threads", `${id}.ndjson`), "utf8")).split("\n").slice(1).filter(Boolean).map((line): ThreadItem => JSON.parse(line));

test("the agent's proposal only records: it names the values up has now, and the thread shows it", () =>
  withProposals([[PROPOSE, { text: "Proposed." }]], async (server, up, fake) => {
    const token = await session(server);
    const { id, listed } = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const id = yield* askInThread(client);
        return { id, listed: yield* client["proposals.list"]() };
      }),
    );
    const [proposal] = listed.proposals;
    assert.equal(listed.canApprove, true);
    assert.deepEqual([proposal?.install, proposal?.status, proposal?.changes], ["example", "open", [{ path: "runners.linux.slots", from: 1, to: 2 }]]);
    assert.match(proposal?.runUrl ?? "", /^https:\/\/github\.com\/owner\/name\/actions\/runs\/\d+$/);
    assert.equal(Date.parse(proposal!.expiresAt) - Date.parse(proposal!.createdAt), 24 * 60 * 60_000);
    assert.equal((await up.readConfig()).runners[0].slots, 1, "nothing changed");
    assert.ok((await threadLog(server, id)).some((item) => item._tag === "ChangeProposed" && item.proposalId === proposal?.id));
    assert.match(fake.toolResults[0]!.text, /"status":"open"/);
  }));

test("a proposal for a field off the allow-list is refused before it's recorded", () =>
  withProposals([[{ tool: "propose_change", input: { install: "example", changes: [{ path: "tokenFile", to: 1 }], reason: "x" } }, { text: "x" }]], async (server, _up, fake) => {
    const token = await session(server);
    const listed = await withClient(server, token, (client) => Effect.gen(function* () {
      yield* askInThread(client);
      return yield* client["proposals.list"]();
    }));
    assert.match(fake.toolResults[0]!.text, /tokenFile isn't a field a proposal can change/);
    assert.deepEqual(listed.proposals, []);
  }));

test("approving needs changes:approve and the exact hash, and applies only what was shown", () =>
  withProposals([[PROPOSE, { text: "Proposed." }]], async (server, up) => {
    const owner = await session(server);
    const reader = await session(server, ["history:read", "runners:read", "threads:operate"]);
    const proposal = await withClient(server, owner, (client) => Effect.gen(function* () {
      yield* askInThread(client);
      return (yield* client["proposals.list"]()).proposals[0]!;
    }));
    const refused = await withClient(server, reader, (client) => Effect.gen(function* () {
      return { listed: yield* client["proposals.list"](), approve: yield* Effect.flip(client["proposals.approve"]({ id: proposal.id, hash: proposal.hash, when: "now" })) };
    }));
    assert.equal(refused.listed.canApprove, false);
    assert.equal(refused.approve._tag === "AuthorizationError" && refused.approve.requiredScope, "changes:approve");
    const outcome = await withClient(server, owner, (client) => Effect.gen(function* () {
      const wrongHash = yield* Effect.flip(client["proposals.approve"]({ id: proposal.id, hash: "b".repeat(64), when: "now" }));
      const approved = yield* client["proposals.approve"]({ id: proposal.id, hash: proposal.hash, when: "now" });
      const again = yield* Effect.flip(client["proposals.approve"]({ id: proposal.id, hash: proposal.hash, when: "now" }));
      return { wrongHash, approved, again };
    }));
    assert.equal(outcome.wrongHash._tag === "ProposalError" && outcome.wrongHash.why, "This isn't the proposal you saw. Look at it again before approving.");
    assert.deepEqual([outcome.approved.status, outcome.approved.decidedBy, outcome.approved.when], ["applied", "desktop", "now"]);
    assert.equal(outcome.again._tag === "ProposalError" && outcome.again.why, "This proposal was already decided.");
    assert.equal((await up.readConfig()).runners[0].slots, 2);
    assert.equal(up.drains.length, 1);
    const logged = (await readFile(join(server.stateDir, "example", "changes.ndjson"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(logged.at(-1).approvedBy.label, "desktop");
    assert.equal(logged.at(-1).hash, proposal.hash);
  }));

test("a config changed by hand since the proposal is refused by up, and nothing is written", () =>
  withProposals([[PROPOSE, { text: "Proposed." }]], async (server, up) => {
    const owner = await session(server);
    const refused = await withClient(server, owner, (client) => Effect.gen(function* () {
      yield* askInThread(client);
      const proposal = (yield* client["proposals.list"]()).proposals[0]!;
      yield* Effect.promise(async () => writeFile(up.configPath, (await readFile(up.configPath, "utf8")).replace('"slots": 1', '"slots": 2')));
      return yield* Effect.flip(client["proposals.approve"]({ id: proposal.id, hash: proposal.hash, when: "idle" }));
    }));
    assert.match(refused._tag === "ProposalError" ? refused.why : "", /changed since this was proposed: runners\.linux\.slots is 2 now, not 1/);
    assert.deepEqual(up.drains, []);
  }));

test("an expired proposal can't be approved", () =>
  withProposals([[PROPOSE, { text: "Proposed." }]], async (server, up) => {
    const owner = await session(server);
    const outcome = await withClient(server, owner, (client) => Effect.gen(function* () {
      yield* askInThread(client);
      const proposal = (yield* client["proposals.list"]()).proposals[0]!;
      const path = join(server.stateDir, ".server", "proposals", `${proposal.id}.json`);
      yield* Effect.promise(async () => writeFile(path, (await readFile(path, "utf8")).replace(proposal.expiresAt, new Date(Date.now() - 1000).toISOString())));
      return { status: (yield* client["proposals.list"]()).proposals[0]!.status, approve: yield* Effect.flip(client["proposals.approve"]({ id: proposal.id, hash: proposal.hash, when: "now" })) };
    }));
    assert.equal(outcome.status, "expired");
    assert.match(outcome.approve._tag === "ProposalError" ? outcome.approve.why : "", /expired/);
    assert.equal((await up.readConfig()).runners[0].slots, 1);
  }));

test("revert proposes the previous values back, and approving it restores them", () =>
  withProposals([[PROPOSE, { text: "Proposed." }]], async (server, up) => {
    const owner = await session(server);
    const revert = await withClient(server, owner, (client) => Effect.gen(function* () {
      yield* askInThread(client);
      const proposal = (yield* client["proposals.list"]()).proposals[0]!;
      yield* client["proposals.approve"]({ id: proposal.id, hash: proposal.hash, when: "now" });
      const revert = yield* client["proposals.revert"]({ id: proposal.id });
      yield* client["proposals.approve"]({ id: revert.id, hash: revert.hash, when: "now" });
      return { revert, of: proposal.id };
    }));
    assert.deepEqual([revert.revert.revertOf, revert.revert.changes], [revert.of, [{ path: "runners.linux.slots", from: 2, to: 1 }]]);
    assert.equal((await up.readConfig()).runners[0].slots, 1);
  }));

test("a Connect session never gets changes:approve, whatever it asks for", () =>
  withProposals([], async (server) => {
    const key = await createProofKey();
    const bound = await Effect.runPromise(server.auth.createPairingCode(ALL_SCOPES, { proofKeyThumbprint: key.thumbprint }));
    const connect = await Effect.runPromise(pairWithCode(server.tunnelBaseUrl, bound.code, "connect", (request) => createProof(key, request)));
    assert.ok(!connect.scopes.includes("changes:approve"));
  }));

test("a proposal out of bounds, or of the wrong kind of value, is refused before it's recorded", () =>
  withProposals(
    [
      [
        { tool: "propose_change", input: { install: "example", changes: [{ path: "runners.linux.slots", to: 64 }], reason: "x" } },
        { tool: "propose_change", input: { install: "example", changes: [{ path: "runners.linux.slots", to: "64m" }], reason: "x" } },
        { tool: "propose_change", input: { install: "example", changes: [{ path: "runners.linux.limits.memory", to: "64g" }], reason: "x" } },
        { text: "x" },
      ],
    ],
    async (server, _up, fake) => {
      const token = await session(server);
      const listed = await withClient(server, token, (client) => Effect.gen(function* () {
        yield* askInThread(client);
        return yield* client["proposals.list"]();
      }));
      assert.match(fake.toolResults[0]!.text, /runners\.linux\.slots must be between 1 and 2/);
      assert.match(fake.toolResults[1]!.text, /runners\.linux\.slots takes a number/);
      assert.match(fake.toolResults[2]!.text, /runners\.linux\.limits\.memory must be between 64m and 16384m/);
      assert.deepEqual(listed.proposals, []);
    },
  ));

test("the agent's three open proposals don't hold back the owner's revert, and a fourth is refused", () =>
  withProposals(
    [
      [PROPOSE, { text: "Proposed." }],
      [
        ...[2000, 2500, 3000].map((to): FakeStep => ({ tool: "propose_change", input: { install: "example", changes: [{ path: "memoryFloor.vmMiB", to }], reason: "x" } })),
        { tool: "propose_change", input: { install: "example", changes: [{ path: "memoryFloor.hostMiB", to: 600 }], reason: "x" } },
        { text: "x" },
      ],
    ],
    async (server, _up, fake) => {
      const owner = await session(server);
      const outcome = await withClient(server, owner, (client) => Effect.gen(function* () {
        const id = yield* askInThread(client);
        const first = (yield* client["proposals.list"]()).proposals[0]!;
        yield* client["proposals.approve"]({ id: first.id, hash: first.hash, when: "now" });
        const done = yield* client["threads.subscribe"]({ id }).pipe(Stream.drop(1), Stream.takeUntil((event) => event._tag === "TurnEnded"), Stream.runDrain, Effect.forkChild);
        yield* Effect.sleep(50);
        yield* client["threads.startTurn"]({ id, text: "More." });
        yield* Fiber.join(done);
        return yield* client["proposals.revert"]({ id: first.id });
      }));
      assert.match(fake.toolResults.at(-1)!.text, /already has 3 proposals waiting/);
      assert.deepEqual(outcome.changes, [{ path: "runners.linux.slots", from: 2, to: 1 }]);
    },
  ));
