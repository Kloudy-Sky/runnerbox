import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import { HARNESSES } from "../threads/provider/harnesses.ts";
import { makeFakeProvider } from "../testing/FakeProvider.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

const KEY = "sk-proj-example-0000000000-e5f6";

const withClient = async <A, E>(server: Server, use: (client: Client) => Effect.Effect<A, E>) => {
  const { code } = await server.createPairingCode(ALL_SCOPES);
  const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
  return Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));
};
const codex = () => makeFakeProvider({ turns: [], models: HARNESSES.codex.models.slice(0, 2) });

test("a Codex account is kept apart from Claude's, so accounts.json and accounts.list stay as older servers and apps read them", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [] }), codex: codex() });
  try {
    const { saved, providers, accounts } = await withClient(server, (client) =>
      Effect.gen(function* () {
        yield* client["providers.save"]({ driver: "claude", label: "Claude, API", model: null, apiKey: "sk-ant-example-0000000000-a1b2" });
        const saved = yield* client["providers.save"]({ driver: "codex", label: "Codex, API", model: "gpt-6.1-sol", apiKey: KEY });
        yield* client["accounts.setDefault"]({ id: saved.id });
        return { saved, providers: yield* client["providers.list"](), accounts: yield* client["accounts.list"]() };
      }),
    );
    assert.deepEqual(
      providers.map((provider) => [provider.driver, provider.models.length, provider.accounts.map((account) => account.label)]),
      [
        ["claude", 3, ["Claude, subscription", "Claude, API"]],
        ["codex", 2, ["Codex, API"]],
      ],
    );
    assert.deepEqual([saved.keyLast4, saved.isDefault], ["e5f6", false]);
    assert.ok(providers[1]!.accounts[0]!.isDefault, "a Codex account can be the default");
    assert.deepEqual(accounts.map((account) => account.driver), ["claude", "claude"]);
    const serverDir = join(server.stateDir, ".server");
    const claudeFile = await readFile(join(serverDir, "accounts.json"), "utf8");
    assert.ok(!claudeFile.includes("codex") && !claudeFile.includes(KEY), "accounts.json holds only Claude's accounts");
    const othersFile = join(serverDir, "provider-accounts.json");
    assert.ok((await readFile(othersFile, "utf8")).includes(KEY));
    assert.equal((await stat(othersFile)).mode & 0o777, 0o600);
  } finally {
    await server.close();
  }
});

test("on a server that doesn't run Codex, its accounts aren't listed and a turn naming one is refused", async () => {
  const first = await startTestServer({ provider: makeFakeProvider({ turns: [] }), codex: codex() });
  const saved = await withClient(first, (client) => client["providers.save"]({ driver: "codex", label: "Codex, API", model: null, apiKey: KEY }));
  await first.close(false);
  const server = await startTestServer({ stateDir: first.stateDir, provider: makeFakeProvider({ turns: [[{ text: "ok" }]] }) });
  try {
    const { providers, refused } = await withClient(server, (client) =>
      Effect.gen(function* () {
        const [item] = (yield* client["inbox.list"]({ days: 14 })).items;
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: item!.id }, days: 14 });
        return {
          providers: yield* client["providers.list"](),
          refused: yield* Effect.flip(client["threads.startTurn"]({ id: thread.id, text: "Why?", accountId: saved.id })),
        };
      }),
    );
    assert.deepEqual(providers.map((provider) => provider.driver), ["claude"]);
    assert.equal(refused._tag === "ThreadError" && refused.reason, "provider_unavailable");
  } finally {
    await server.close();
  }
});
