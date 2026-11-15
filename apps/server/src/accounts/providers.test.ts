import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, BUILT_IN_ACCOUNT_ID, Provider } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeFakeProvider } from "../testing/FakeProvider.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

const KEY = "sk-ant-example-0000000000-c3d4";

const session = async (server: Server, scopes: ReadonlyArray<AuthScope> = ALL_SCOPES) => {
  const { code } = await server.createPairingCode(scopes);
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"))).token;
};
const withClient = <A, E>(server: Server, token: string, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));

test("providers.list gives each driver its models and accounts, with only a key's last four characters", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [] }) });
  try {
    const token = await session(server);
    const providers = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        yield* client["providers.save"]({ driver: "claude", label: "Claude, API", model: "sonnet", apiKey: KEY });
        return yield* client["providers.list"]();
      }),
    );
    assert.deepEqual(
      providers.map((provider) => [provider.driver, provider.models.map((model) => model.id)]),
      [["claude", ["haiku", "sonnet", "opus"]]],
    );
    assert.deepEqual(
      providers[0]!.accounts.map((account) => [account.id === BUILT_IN_ACCOUNT_ID, account.keyLast4, account.model]),
      [
        [true, null, null],
        [false, "c3d4", "sonnet"],
      ],
    );
    assert.ok(!JSON.stringify(providers).includes(KEY), "no RPC answer carries the key");
  } finally {
    await server.close();
  }
});

test("providers.save refuses a driver this server can't run, and writes nothing", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [] }) });
  try {
    const token = await session(server);
    const refused = await withClient(server, token, (client) => Effect.flip(client["providers.save"]({ driver: "codex", label: "Codex, API", model: null, apiKey: KEY })));
    assert.equal(refused._tag === "AccountError" && refused.reason, "unknown_driver");
    const file = await readFile(join(server.stateDir, ".server", "accounts.json"), "utf8").catch(() => null);
    assert.equal(file, null);
  } finally {
    await server.close();
  }
});

test("saving through providers needs access:write, as accounts.save does", async () => {
  const server = await startTestServer({ provider: makeFakeProvider({ turns: [] }) });
  try {
    const token = await session(server, ["history:read", "runners:read", "threads:operate"]);
    const outcome = await withClient(server, token, (client) =>
      Effect.gen(function* () {
        return {
          listed: yield* client["providers.list"](),
          refused: yield* Effect.flip(client["providers.save"]({ driver: "claude", label: "x", model: null, apiKey: KEY })),
        };
      }),
    );
    assert.equal(outcome.listed.length, 1);
    assert.equal(outcome.refused._tag === "AuthorizationError" && outcome.refused.requiredScope, "access:write");
  } finally {
    await server.close();
  }
});

// The reason `driver` is an open ID here: a later server lists a driver this app was built without.
test("an app reads a provider whose driver it doesn't know", () => {
  const later = {
    driver: "codex",
    label: "Codex",
    status: { provider: "Codex", available: true, fix: null },
    models: [{ id: "example-model", label: "Example" }],
    accounts: [
      { id: "account-0a1b2c3d", driver: "codex", label: "Codex, API", model: null, billing: "api_key", keyLast4: "c3d4", isDefault: false, builtIn: false, status: { provider: "Codex", available: true, fix: null } },
    ],
  };
  assert.equal(Schema.decodeUnknownSync(Provider)(later).accounts[0]!.driver, "codex");
});
