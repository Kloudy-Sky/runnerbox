import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, type MonitorSettings, type ThreadItem } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import { type FakeStep, makeFakeProvider } from "../testing/FakeProvider.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

// Two of the fixtures' "Needs you" items.
const ITEM = "failure:owner/name\u0000ci\u0000test:infra";
const SLOT = "failing_slot:example:docker";
const ON: MonitorSettings = { enabled: true, dailyLimit: 5, accountId: null, model: null };

const session = async (server: Server, scopes: ReadonlyArray<AuthScope> = ALL_SCOPES) => {
  const { code } = await server.createPairingCode(scopes);
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, "desktop"))).token;
};
const withClient = <A, E>(server: Server, token: string, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));

const editState = async (server: Server, edit: (state: { seen: Record<string, string>; day: object }) => void) => {
  const path = join(server.stateDir, ".server", "monitor.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  edit(state);
  await writeFile(path, JSON.stringify(state));
};

// As though these items had just appeared: the monitor forgets it saw them. `day` rewrites today's counts.
const arrive = (server: Server, ids: ReadonlyArray<string>, day?: { date: string; looks: number }) =>
  editState(server, (state) => {
    for (const id of ids) delete state.seen[id];
    if (day) state.day = { ...state.day, ...day };
  });

// As though `days` had passed since every item was last seen.
const age = (server: Server, days: number) =>
  editState(server, (state) => {
    for (const [id, at] of Object.entries(state.seen)) state.seen[id] = new Date(Date.parse(at) - days * 24 * 60 * 60_000).toISOString();
  });

const threadItems = async (server: Server) => {
  const dir = join(server.stateDir, ".server", "threads");
  const [file] = await readdir(dir);
  return (await readFile(join(dir, file!), "utf8")).split("\n").slice(1).filter(Boolean).map((line): ThreadItem => JSON.parse(line));
};

test("monitors are off by default, and turning them on skips what's already in the inbox", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Looked." }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const token = await session(server);
    const before = await withClient(server, token, (client) => client["monitors.status"]());
    assert.equal(before.settings.enabled, false);
    await server.checkMonitors();
    await withClient(server, token, (client) => client["monitors.save"](ON));
    await server.checkMonitors();
    assert.equal(fake.inputs.length, 0, "nothing already there is looked into");
  } finally {
    await server.close();
  }
});

test("a new item gets one read-only look on Haiku, marked as the monitor's, and stays marked until read", async () => {
  const fake = makeFakeProvider({ turns: [[{ tool: "propose_change", input: { install: "example", changes: [{ path: "runners.linux.slots", to: 2 }], reason: "x" } }, { text: "The VM ran short of memory." }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const token = await session(server);
    await withClient(server, token, (client) => client["monitors.save"](ON));
    await arrive(server, [ITEM]);
    await server.checkMonitors();
    assert.deepEqual(fake.inputs.map((input) => [input.propose, input.reproduce, input.account.model]), [[false, false, "haiku"]]);
    assert.match(fake.toolResults[0]!.text, /Only a thread's turn can propose/, "propose_change is refused if called");
    const asked = (await threadItems(server)).find((item) => item._tag === "UserMessage");
    assert.equal(asked?._tag === "UserMessage" && asked.source, "monitor");
    const status = await withClient(server, token, (client) => client["monitors.status"]());
    assert.deepEqual([status.today.looks, status.runs[0]?.outcome, status.runs[0]?.itemId, status.unread], [1, "completed", ITEM, [ITEM]]);
    const proposals = await withClient(server, token, (client) => client["proposals.list"]());
    assert.deepEqual(proposals.proposals, []);
    await withClient(server, token, (client) => client["monitors.markRead"]({ itemId: ITEM }));
    assert.deepEqual((await withClient(server, token, (client) => client["monitors.status"]())).unread, []);
  } finally {
    await server.close();
  }
});

test("at the limit, new items are skipped, not queued, and the next day starts from zero", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Looked." }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const token = await session(server);
    await withClient(server, token, (client) => client["monitors.save"]({ ...ON, dailyLimit: 1 }));
    await arrive(server, [ITEM, SLOT]);
    await server.checkMonitors();
    const capped = await withClient(server, token, (client) => client["monitors.status"]());
    assert.deepEqual([fake.inputs.length, capped.today.looks, capped.today.skipped], [1, 1, 1]);
    await server.checkMonitors();
    assert.equal(fake.inputs.length, 1, "a skipped item isn't looked into later");
    await arrive(server, [SLOT], { date: "2000-01-01", looks: 1 });
    await server.checkMonitors();
    const next = await withClient(server, token, (client) => client["monitors.status"]());
    assert.deepEqual([fake.inputs.length, next.today.looks, next.today.skipped], [2, 1, 0]);
  } finally {
    await server.close();
  }
});

test("an item that stays in the inbox past 14 days isn't new again", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Looked." }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const token = await session(server);
    await withClient(server, token, (client) => client["monitors.save"](ON));
    await age(server, 13);
    await server.checkMonitors();
    await age(server, 2);
    await server.checkMonitors();
    assert.equal(fake.inputs.length, 0);
  } finally {
    await server.close();
  }
});

test("a look that can't start is shown with why, and isn't counted", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Looked." }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const token = await session(server);
    await withClient(server, token, (client) => client["monitors.save"]({ ...ON, accountId: "removed" }));
    await arrive(server, [ITEM]);
    await server.checkMonitors();
    const status = await withClient(server, token, (client) => client["monitors.status"]());
    assert.deepEqual([fake.inputs.length, status.today.looks, status.runs[0]?.outcome, status.unread], [0, 0, "failed", []]);
    assert.match(status.runs[0]?.why ?? "", /doesn't exist any more/);
  } finally {
    await server.close();
  }
});

test("a restart remembers what was seen, so nothing is looked into twice", async () => {
  const first = await startTestServer({ provider: makeFakeProvider({ turns: [[{ text: "Looked." }]] }) });
  const token = await session(first);
  await withClient(first, token, (client) => client["monitors.save"](ON));
  await arrive(first, [ITEM]);
  await first.checkMonitors();
  await first.close(false);
  const fake = makeFakeProvider({ turns: [[{ text: "Again." }]] });
  const again = await startTestServer({ stateDir: first.stateDir, provider: fake });
  try {
    await again.checkMonitors();
    assert.equal(fake.inputs.length, 0);
  } finally {
    await again.close();
  }
});

test("turning monitors off stops a look in progress", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "Looking" }, { hang: true }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const token = await session(server);
    await withClient(server, token, (client) => client["monitors.save"](ON));
    await arrive(server, [ITEM]);
    const pass = server.checkMonitors();
    while (fake.inputs.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    await withClient(server, token, (client) => client["monitors.save"]({ ...ON, enabled: false }));
    await pass;
    const status = await withClient(server, token, (client) => client["monitors.status"]());
    assert.equal(status.runs[0]?.outcome, "interrupted");
  } finally {
    await server.close();
  }
});

test("changing monitors needs access:write; seeing them needs only threads", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [[{ text: "x" }]] }) });
  try {
    const token = await session(server, ["history:read", "runners:read", "threads:operate"]);
    const outcome = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        return { status: yield* client["monitors.status"](), save: yield* Effect.flip(client["monitors.save"](ON)) };
      }),
    );
    assert.equal(outcome.status.canConfigure, false);
    assert.equal(outcome.save._tag === "AuthorizationError" && outcome.save.requiredScope, "access:write");
  } finally {
    await server.close();
  }
});
