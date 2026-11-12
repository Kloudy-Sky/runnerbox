import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, type ThreadItem } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { startFakeUp } from "../testing/fakeUp.ts";
import { type FakeStep, makeFakeProvider } from "../testing/FakeProvider.ts";
import { LINUX_IMAGE, writeFixtures } from "../testing/fixtures.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

// The fixtures' failure the machine caused: ci / test killed for memory, then passed on retry.
const ITEM = "failure:owner/name\u0000ci\u0000test:infra";
const HOSTILE = `echo "$HOME" && touch '/tmp/x'; \`id\` $(whoami)`;

// A short state directory, since the socket's whole path must fit in about 100 characters.
async function withReproduce(turns: ReadonlyArray<ReadonlyArray<FakeStep>>, use: (server: Server, up: Awaited<ReturnType<typeof startFakeUp>>, fake: ReturnType<typeof makeFakeProvider>) => Promise<void>) {
  const stateDir = await mkdtemp(join(tmpdir(), "rbx-"));
  await writeFixtures(stateDir, Date.now());
  const fake = makeFakeProvider({ turns });
  const server = await startTestServer({ stateDir, provider: fake });
  const up = await startFakeUp(join(stateDir, "example"), { run: (command) => ({ exitCode: command === "false" ? 1 : 0, output: `ran: ${command}\n` }) });
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
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"))).token;
};
const withClient = <A, E>(server: Server, token: string, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));

// Asks a question and waits for the turn to end.
const ask = (client: Client, id: string) =>
  Effect.gen(function* () {
    const done = yield* client["threads.subscribe"]({ id }).pipe(Stream.drop(1), Stream.takeUntil((event) => event._tag === "TurnEnded"), Stream.runDrain, Effect.forkChild);
    yield* Effect.sleep(50);
    yield* client["threads.startTurn"]({ id, text: "Rerun it." });
    yield* Fiber.join(done);
  });

const threadLog = async (server: Server, id: string) =>
  (await readFile(join(server.stateDir, ".server", "threads", `${id}.ndjson`), "utf8"))
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line): ThreadItem => JSON.parse(line));

test("a reproduce runs on the image the job's runner recorded, never one a client sends", () =>
  withReproduce([], async (server, up) => {
    const token = await session(server);
    const checked = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
        const check = yield* client["threads.checkReproduce"]({ id: thread.id });
        // Extra fields aren't part of the request: the image can only come from the runner event.
        const payload = { id: thread.id, network: "setup" as const, image: "attacker/image:latest" };
        yield* client["threads.startReproduce"](payload);
        return { check, id: thread.id };
      }),
    );
    assert.deepEqual(checked.check._tag === "Ready" && [checked.check.kind, checked.check.imageRecorded], ["linux", true]);
    const [start] = up.requests;
    assert.equal(start?.op === "start" && start.image, LINUX_IMAGE);
    assert.equal(start?.op === "start" && start.network, "setup");
    assert.equal(start?.op === "start" && start.commit, checked.check._tag === "Ready" ? checked.check.commit : "");
    const started = (await threadLog(server, checked.id)).find((item) => item._tag === "ReproduceStarted");
    assert.deepEqual(started && [started.image, started.imageFallback], [LINUX_IMAGE, false]);
  }));

test("only the turn of the thread whose reproduce runs can run commands, and a command arrives as data", () =>
  withReproduce(
    [
      [{ tool: "repro_exec", input: { command: HOSTILE, timeoutSec: 60 } }, { text: "Done." }],
      [{ tool: "repro_exec", input: { command: "id", timeoutSec: 60 } }, { text: "Done." }],
    ],
    async (server, up, fake) => {
      const token = await session(server);
      const ids = await withClient(server, token, (client) =>
        Effect.gen(function* () {
          const reproducing = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
          const other = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
          yield* client["threads.startReproduce"]({ id: reproducing.id, network: "on" });
          yield* ask(client, reproducing.id);
          yield* ask(client, other.id);
          return { reproducing: reproducing.id, other: other.id };
        }),
      );
      const execs = up.requests.filter((request) => request.op === "exec");
      assert.deepEqual(execs.map((request) => request.op === "exec" && request.command), [HOSTILE]);
      assert.deepEqual(fake.inputs.map((input) => input.reproduce), [true, false]);
      assert.match(fake.toolResults[1]!.text, /can't run commands/);
      const command = (await threadLog(server, ids.reproducing)).find((item) => item._tag === "ReproduceCommand");
      assert.deepEqual(command && [command.command, command.exitCode, command.output], [HOSTILE, 0, `ran: ${HOSTILE}\n`]);
      assert.ok(!(await threadLog(server, ids.other)).some((item) => item._tag === "ReproduceCommand"));
    },
  ));

test("when up removes the reproduce, the thread says why once, however often the agent retries", () =>
  withReproduce([[{ tool: "repro_exec", input: { command: "true", timeoutSec: 60 } }, { tool: "repro_exec", input: { command: "true", timeoutSec: 60 } }, { text: "Gone." }]], async (server, up) => {
    const token = await session(server);
    const id = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
        yield* client["threads.startReproduce"]({ id: thread.id, network: "on" });
        // As when a real job's slot waits for memory.
        yield* Effect.promise(() => up.reproducer.stop("00000000"));
        yield* ask(client, thread.id);
        return thread.id;
      }),
    );
    const ended = (await threadLog(server, id)).filter((item) => item._tag === "ReproduceEnded");
    assert.deepEqual(ended.map((item) => item._tag === "ReproduceEnded" && item.reason), ["This reproduce ended: stopped."]);
  }));

test("stopping a reproduce up already removed logs up's reason, not the owner's", () =>
  withReproduce([], async (server, up) => {
    const token = await session(server);
    const id = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
        yield* client["threads.startReproduce"]({ id: thread.id, network: "on" });
        yield* Effect.promise(() => up.reproducer.stop("00000000"));
        yield* client["threads.stopReproduce"]({ id: thread.id });
        return thread.id;
      }),
    );
    const ended = (await threadLog(server, id)).filter((item) => item._tag === "ReproduceEnded");
    assert.deepEqual(ended.map((item) => item._tag === "ReproduceEnded" && item.reason), ["This reproduce ended: stopped."]);
  }));

test("the server won't talk to a socket whose directory other users can open", () =>
  withReproduce([], async (server) => {
    await chmod(join(server.stateDir, "example", "reproduce"), 0o755);
    const token = await session(server);
    const refused = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
        return yield* Effect.flip(client["threads.startReproduce"]({ id: thread.id, network: "on" }));
      }),
    );
    assert.equal(refused._tag === "ReproduceError" && refused.why, "Its directory is open to other users, so the server won't use it.");
  }));

test("starting a reproduce needs threads:reproduce", () =>
  withReproduce([], async (server, up) => {
    const token = await session(server, ["history:read", "runners:read", "threads:operate"]);
    const refused = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
        return yield* Effect.flip(client["threads.startReproduce"]({ id: thread.id, network: "on" }));
      }),
    );
    assert.equal(refused._tag === "AuthorizationError" && refused.requiredScope, "threads:reproduce");
    assert.equal(up.requests.length, 0);
  }));

test("stopping a reproduce removes it and logs one line saying the owner did", () =>
  withReproduce([], async (server, up) => {
    const token = await session(server);
    const id = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
        yield* client["threads.startReproduce"]({ id: thread.id, network: "on" });
        yield* client["threads.stopReproduce"]({ id: thread.id });
        return thread.id;
      }),
    );
    const ended = (await threadLog(server, id)).filter((item) => item._tag === "ReproduceEnded");
    assert.deepEqual(ended.map((item) => item._tag === "ReproduceEnded" && item.reason), ["The owner stopped it."]);
    await assert.rejects(up.reproducer.exec({ op: "exec", id: "00000000", command: "true", timeoutSec: 5 }), /ended: stopped/);
  }));

test("a turn gets the shell only when the session asking holds threads:reproduce, whoever started the reproduce", () =>
  withReproduce(
    [
      [{ tool: "repro_exec", input: { command: "echo narrow", timeoutSec: 60 } }, { text: "Done." }],
      [{ tool: "repro_exec", input: { command: "echo full", timeoutSec: 60 } }, { text: "Done." }],
    ],
    async (server, up, fake) => {
      const full = await session(server);
      const narrow = await session(server, ["history:read", "runners:read", "threads:operate"]);
      const id = await withClient(server, full, (client) =>
        Effect.gen(function* () {
          const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: ITEM }, days: 14 });
          yield* client["threads.startReproduce"]({ id: thread.id, network: "on" });
          return thread.id;
        }),
      );
      await withClient(server, narrow, (client) => ask(client, id));
      await withClient(server, full, (client) => ask(client, id));
      assert.deepEqual(fake.inputs.map((input) => input.reproduce), [false, true]);
      assert.match(fake.toolResults[0]!.text, /can't run commands/);
      assert.deepEqual(up.requests.flatMap((request) => (request.op === "exec" ? [request.command] : [])), ["echo full"]);
    },
  ));
