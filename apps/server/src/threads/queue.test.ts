import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type ThreadEvent } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { makeFakeProvider } from "../testing/FakeProvider.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

const token = async (server: Server) => {
  const { code } = await server.createPairingCode(ALL_SCOPES);
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"))).token;
};
const withClient = <A, E>(server: Server, token: string, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));
const newThread = (client: Client) =>
  Effect.gen(function* () {
    const [item] = (yield* client["inbox.list"]({ days: 14 })).items;
    assert.ok(item);
    return yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: item.id }, days: 14 });
  });
const tagsOf = (events: ReadonlyArray<ThreadEvent>) => events.map((event) => event._tag).filter((tag) => tag !== "AgentTextDelta");

test("a question asked while a turn runs waits, blocks any other start, and goes once that turn ends", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "First answer, slowly." }], [{ text: "Second." }]], delayMs: 40 });
  const server = await startTestServer({ provider: fake });
  try {
    const result = await withClient(server, await token(server), (client) =>
      Effect.gen(function* () {
        const thread = yield* newThread(client);
        const watching = yield* client["threads.subscribe"]({ id: thread.id }).pipe(
          Stream.filter((event) => event._tag !== "AgentTextDelta"),
          Stream.takeUntil((event) => event._tag === "TurnEnded" && event.turnId !== first.turnId),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.sleep(50);
        const first = yield* client["threads.queueTurn"]({ id: thread.id, text: "Why?" });
        const waiting = yield* client["threads.queueTurn"]({ id: thread.id, text: "And the slot?" });
        const full = yield* Effect.flip(client["threads.queueTurn"]({ id: thread.id, text: "Third?" }));
        // Once its turn ends, nothing else can get in ahead of the waiting question.
        const blocked = yield* Effect.flip(client["threads.startTurn"]({ id: thread.id, text: "Me first?" }));
        const snapshot = yield* client["threads.subscribe"]({ id: thread.id }).pipe(Stream.take(1), Stream.runCollect);
        return { first, waiting, full, blocked, snapshot: [...snapshot][0], events: [...(yield* Fiber.join(watching))] };
      }),
    );
    assert.ok(result.first.turnId !== null, "with nothing running it starts at once");
    assert.equal(result.waiting.turnId, null);
    assert.equal(result.full._tag === "ThreadError" && result.full.reason, "queue_full");
    assert.equal(result.blocked._tag === "ThreadError" && result.blocked.reason, "turn_running");
    assert.equal(result.snapshot?._tag === "Snapshot" && result.snapshot.queued?.text, "And the slot?");
    assert.deepEqual(tagsOf(result.events), ["Snapshot", "UserMessage", "Queued", "AgentText", "TurnEnded", "UserMessage", "QueueCleared", "AgentText", "TurnEnded"]);
    const cleared = result.events.find((event) => event._tag === "QueueCleared");
    assert.equal(cleared?._tag === "QueueCleared" && cleared.reason, "started");
    assert.match(fake.inputs[1]?.prompt ?? "", /Owner: And the slot\?$/);
  } finally {
    await server.close();
  }
});

test("Stop doesn't send the waiting question: the stream hands its text back", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Working " }, { hang: true }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const events = await withClient(server, await token(server), (client) =>
      Effect.gen(function* () {
        const thread = yield* newThread(client);
        yield* client["threads.startTurn"]({ id: thread.id, text: "Why?" });
        yield* Effect.sleep(50);
        const watching = yield* client["threads.subscribe"]({ id: thread.id }).pipe(
          Stream.filter((event) => event._tag !== "AgentTextDelta"),
          Stream.takeUntil((event) => event._tag === "TurnEnded"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* client["threads.queueTurn"]({ id: thread.id, text: "Keep this" });
        yield* client["threads.interrupt"]({ id: thread.id });
        const events = [...(yield* Fiber.join(watching))];
        yield* Effect.sleep(100);
        return events;
      }),
    );
    const cleared = events.find((event) => event._tag === "QueueCleared");
    assert.deepEqual(cleared?._tag === "QueueCleared" && [cleared.reason, cleared.text], ["stopped", "Keep this"]);
    assert.equal(fake.inputs.length, 1, "the waiting question never ran");
  } finally {
    await server.close();
  }
});

test("a question waiting behind a monitor's look runs as the owner's, and isn't counted as a look", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Owner's answer." }]], delayMs: 30, monitor: { steps: [{ text: "Looking into it, word by word, for a while." }], costUsd: 0.01 } });
  const server = await startTestServer({ provider: fake });
  try {
    const app = await token(server);
    await withClient(server, app, (client) => client["monitors.save"]({ enabled: true, dailyLimit: 5, accountId: null, model: null }));
    // As though the fixtures' machine failure had just appeared.
    const path = join(server.stateDir, ".server", "monitor.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    delete state.seen["failure:owner/name\u0000ci\u0000test:infra"];
    await writeFile(path, JSON.stringify(state));
    const looking = server.checkMonitors();
    const { items, status } = await withClient(server, app, (client) =>
      Effect.gen(function* () {
        let threadId: string | undefined;
        while (threadId === undefined) {
          yield* Effect.sleep(20);
          threadId = (yield* client["threads.list"]({})).find((thread) => thread.running)?.id;
        }
        const queued = yield* client["threads.queueTurn"]({ id: threadId, text: "Is it the VM?" });
        assert.equal(queued.turnId, null, "it waits behind the look");
        yield* Effect.promise(() => looking);
        yield* Effect.sleep(800);
        return { items: (yield* client["threads.read"]({ id: threadId })).items, status: yield* client["monitors.status"]() };
      }),
    );
    const asked = items.flatMap((item) => (item._tag === "UserMessage" ? [[item.text, item.source ?? "owner"]] : []));
    assert.equal(asked.length, 2);
    assert.deepEqual(asked[1], ["Is it the VM?", "owner"]);
    assert.deepEqual(fake.inputs.map((input) => input.propose), [false, true], "the second turn is the owner's, with proposals");
    assert.equal(status.today.looks, 1);
  } finally {
    await server.close();
  }
});

test("Stop while the waiting question is still starting wins: it isn't sent, and its text comes back", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Quick." }], [{ text: "Should not run." }]], statusDelayMs: 300 });
  const server = await startTestServer({ provider: fake });
  try {
    const { events, items } = await withClient(server, await token(server), (client) =>
      Effect.gen(function* () {
        const thread = yield* newThread(client);
        const watching = yield* client["threads.subscribe"]({ id: thread.id }).pipe(
          Stream.filter((event) => event._tag !== "AgentTextDelta"),
          Stream.takeUntil((event) => event._tag === "QueueCleared"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* client["threads.startTurn"]({ id: thread.id, text: "Why?" });
        yield* client["threads.queueTurn"]({ id: thread.id, text: "Keep this" });
        // The first turn ends almost at once; the waiting one is then checking its account.
        yield* client["threads.subscribe"]({ id: thread.id }).pipe(Stream.takeUntil((event) => event._tag === "TurnEnded"), Stream.runDrain);
        yield* client["threads.interrupt"]({ id: thread.id });
        const events = [...(yield* Fiber.join(watching))];
        yield* Effect.sleep(500);
        return { events, items: (yield* client["threads.read"]({ id: thread.id })).items };
      }),
    );
    const cleared = events.at(-1);
    assert.deepEqual(cleared?._tag === "QueueCleared" && [cleared.reason, cleared.text], ["stopped", "Keep this"]);
    assert.equal(items.filter((item) => item._tag === "UserMessage").length, 1);
    assert.equal(fake.inputs.length, 1);
  } finally {
    await server.close();
  }
});

test("turning monitors off stops the look, and the owner's question waiting behind it still goes", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Owner's answer." }]], delayMs: 30, monitor: { steps: [{ text: "Looking into it, word by word, for quite a while longer." }], costUsd: 0.01 } });
  const server = await startTestServer({ provider: fake });
  try {
    const app = await token(server);
    await withClient(server, app, (client) => client["monitors.save"]({ enabled: true, dailyLimit: 5, accountId: null, model: null }));
    const path = join(server.stateDir, ".server", "monitor.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    delete state.seen["failure:owner/name\u0000ci\u0000test:infra"];
    await writeFile(path, JSON.stringify(state));
    const looking = server.checkMonitors();
    const items = await withClient(server, app, (client) =>
      Effect.gen(function* () {
        let threadId: string | undefined;
        while (threadId === undefined) {
          yield* Effect.sleep(20);
          threadId = (yield* client["threads.list"]({})).find((thread) => thread.running)?.id;
        }
        yield* client["threads.queueTurn"]({ id: threadId, text: "Is it the VM?" });
        yield* client["monitors.save"]({ enabled: false, dailyLimit: 5, accountId: null, model: null });
        yield* Effect.promise(() => looking);
        yield* Effect.sleep(800);
        return (yield* client["threads.read"]({ id: threadId })).items;
      }),
    );
    const ends = items.flatMap((item) => (item._tag === "TurnEnded" ? [item.outcome] : []));
    assert.deepEqual(ends, ["interrupted", "completed"]);
    assert.deepEqual(fake.inputs.map((input) => input.propose), [false, true]);
  } finally {
    await server.close();
  }
});
