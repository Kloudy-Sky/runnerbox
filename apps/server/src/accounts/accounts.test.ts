import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, BUILT_IN_ACCOUNT_ID } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { makeFakeProvider } from "../testing/FakeProvider.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

const KEY = "sk-ant-example-0000000000-a1b2";

const session = async (server: Server, scopes: ReadonlyArray<AuthScope> = ALL_SCOPES) => {
  const { code } = await server.createPairingCode(scopes);
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"))).token;
};
const withClient = <A, E>(server: Server, token: string, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));

test("an API key is write-only: clients see its last four characters, and the file is the owner's alone", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [[{ text: "ok" }]] }) });
  try {
    const token = await session(server);
    const { saved, listed } = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const saved = yield* client["accounts.save"]({ driver: "claude", label: "Claude, API", model: "haiku", apiKey: KEY });
        return { saved, listed: yield* client["accounts.list"]() };
      }),
    );
    assert.deepEqual([saved.billing, saved.keyLast4, saved.isDefault], ["api_key", "a1b2", false]);
    assert.ok(!JSON.stringify(listed).includes(KEY), "no RPC answer carries the key");
    assert.deepEqual(listed.map((account) => [account.id === BUILT_IN_ACCOUNT_ID, account.billing, account.isDefault]), [
      [true, "subscription", true],
      [false, "api_key", false],
    ]);
    const file = join(server.stateDir, ".server", "accounts.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await server.close();
  }
});

test("the subscription account can't take a key or be removed, and removing the default falls back to it", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [[{ text: "ok" }]] }) });
  try {
    const token = await session(server);
    const outcome = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const keyed = yield* Effect.flip(client["accounts.save"]({ id: BUILT_IN_ACCOUNT_ID, driver: "claude", label: "x", model: null, apiKey: KEY }));
        const removed = yield* Effect.flip(client["accounts.remove"]({ id: BUILT_IN_ACCOUNT_ID }));
        const api = yield* client["accounts.save"]({ driver: "claude", label: "Claude, API", model: null, apiKey: KEY });
        yield* client["accounts.setDefault"]({ id: api.id });
        const defaultBefore = (yield* client["accounts.list"]()).find((account) => account.isDefault)?.id;
        yield* client["accounts.remove"]({ id: api.id });
        const defaultAfter = (yield* client["accounts.list"]()).find((account) => account.isDefault)?.id;
        return { keyed, removed, apiId: api.id, defaultBefore, defaultAfter };
      }),
    );
    assert.equal(outcome.keyed._tag === "AccountError" && outcome.keyed.reason, "built_in");
    assert.equal(outcome.removed._tag === "AccountError" && outcome.removed.reason, "built_in");
    assert.equal(outcome.defaultBefore, outcome.apiId);
    assert.equal(outcome.defaultAfter, BUILT_IN_ACCOUNT_ID);
  } finally {
    await server.close();
  }
});

test("changing accounts needs access:write; picking one needs only threads", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [[{ text: "ok" }]] }) });
  try {
    const token = await session(server, ["history:read", "runners:read", "threads:operate"]);
    const outcome = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        return { listed: yield* client["accounts.list"](), refused: yield* Effect.flip(client["accounts.save"]({ driver: "claude", label: "x", model: null, apiKey: KEY })) };
      }),
    );
    assert.equal(outcome.listed.length, 1);
    assert.equal(outcome.refused._tag === "AuthorizationError" && outcome.refused.requiredScope, "access:write");
  } finally {
    await server.close();
  }
});

test("a turn runs as the account it names: only that account's key reaches the provider, and no log holds it", async () => {
  const fake = makeFakeProvider({ turns: [[{ text: "First." }], [{ text: "Second." }]] });
  const server = await startTestServer({ provider: fake });
  try {
    const token = await session(server);
    await withClient(server, token, (client) =>
      Effect.gen(function* () {
        const api = yield* client["accounts.save"]({ driver: "claude", label: "Claude, API", model: "haiku", apiKey: KEY });
        const [item] = (yield* client["inbox.list"]({ days: 14 })).items;
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: item!.id }, days: 14 });
        for (const accountId of [undefined, api.id]) {
          const done = yield* client["threads.subscribe"]({ id: thread.id }).pipe(
            Stream.drop(1),
            Stream.takeUntil((event) => event._tag === "TurnEnded"),
            Stream.runDrain,
            Effect.forkChild,
          );
          yield* Effect.sleep(50);
          yield* client["threads.startTurn"]({ id: thread.id, text: "Why?", ...(accountId ? { accountId } : {}) });
          yield* Fiber.join(done);
        }
      }),
    );
    assert.deepEqual(fake.inputs.map((input) => [input.account.apiKey, input.account.model]), [
      [null, null],
      [KEY, "haiku"],
    ]);
    const threads = join(server.stateDir, ".server", "threads");
    const [log] = await readdir(threads);
    const text = await readFile(join(threads, log!), "utf8");
    assert.ok(!text.includes(KEY), "the thread's log names the account, never its key");
    assert.match(text, /"accountId":"account-[0-9a-f]{8}"/);
  } finally {
    await server.close();
  }
});
