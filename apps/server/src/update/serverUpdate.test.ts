import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, MCP_SCOPES, type UpdateProgress } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import { makeFakeProvider } from "../testing/FakeProvider.ts";
import { startTestServer } from "../testing/testServer.ts";
import type { ReleaseSource } from "./download.ts";
import { type ReleaseKey, releaseMessage } from "./supervisor/signature.ts";
import * as Supervision from "./Supervision.ts";
import { updatePaths } from "./supervisor/updateFiles.ts";

const NEW = "0.3.2";
const RELEASE = "// runnerbox.js 0.3.2\n".repeat(50_000);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// What the stand-in for GitHub serves for v0.3.2.
// `signature` is runnerbox.js.sig's text; without it the release has none.
type Release = { checksum?: string; status?: number; redirectTo?: string; signature?: string };

// A local server in GitHub's place, serving one release under /v<version>/.
async function startReleases(release: Release = {}) {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (release.redirectTo) return void response.writeHead(302, { location: release.redirectTo }).end();
    if (release.status) return void response.writeHead(release.status).end();
    if (request.url === `/v${NEW}/runnerbox.js`) return void response.writeHead(200, { "content-length": Buffer.byteLength(RELEASE) }).end(RELEASE);
    if (request.url === `/v${NEW}/runnerbox.js.sig` && release.signature !== undefined) return void response.writeHead(200).end(`${release.signature}\n`);
    if (request.url === `/v${NEW}/runnerbox.js.sha256`) return void response.writeHead(200).end(`${release.checksum ?? sha256(RELEASE)}  runnerbox.js\n`);
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const source: ReleaseSource = {
    releaseUrl: (version) => `http://127.0.0.1:${port}/v${version}/`,
    redirectAllowed: (url) => url.host === `127.0.0.1:${port}`,
  };
  return { source, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

type Asked = { version: string; path: string; sha256: string; signature: string | null };

// A server under a stand-in supervisor that accepts every update, or answers `refuse`.
async function withUpdates(options: { release?: Release; refuse?: string; supervised?: boolean; source?: "none"; keys?: ReadonlyArray<ReleaseKey> }, body: (context: { server: Awaited<ReturnType<typeof startTestServer>>; file: string; asked: Asked[] }) => Promise<void>, provider?: ReturnType<typeof makeFakeProvider>) {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-server-update-"));
  const file = join(dir, "runnerbox.js");
  await writeFile(file, "// runnerbox.js 0.0.0\n");
  const releases = await startReleases(options.release);
  const asked: Asked[] = [];
  const supervision = Supervision.layerTest(options.supervised === false ? null : { protocol: 1, file, role: "active" }, (request) => {
    asked.push(request);
    return options.refuse ? Effect.fail(new Supervision.UpdateRefused({ reason: options.refuse })) : Effect.succeed("0123456789abcdef");
  });
  const server = await startTestServer({ updates: { source: options.source === "none" ? null : releases.source, keys: options.keys ?? [], supervision }, ...(provider ? { provider } : {}) });
  try {
    await body({ server, file, asked });
  } finally {
    await server.close();
    await releases.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const session = async (server: Awaited<ReturnType<typeof startTestServer>>, scopes: ReadonlyArray<AuthScope> = ALL_SCOPES) => {
  const { code } = await server.createPairingCode(scopes);
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"))).token;
};

const updateTo = (server: Awaited<ReturnType<typeof startTestServer>>, token: string, version = NEW) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(Stream.runCollect(client["server.update"]({ version }))))));

const statusOf = (server: Awaited<ReturnType<typeof startTestServer>>, token: string) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => client["server.updateStatus"]())));

const steps = (exit: Exit.Exit<ReadonlyArray<UpdateProgress>, unknown>) => (Exit.isSuccess(exit) ? [...new Set(exit.value.map((step) => step._tag))] : Cause.pretty(exit.cause));
const failure = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "succeeded");

test("an update downloads the release beside runnerbox.js, checks it, and hands it to the supervisor", async () => {
  await withUpdates({}, async ({ server, file, asked }) => {
    const token = await session(server);
    assert.equal((await statusOf(server, token)).blocker, null);
    const exit = await updateTo(server, token);
    assert.deepEqual(steps(exit), ["Downloading", "Checking", "Starting"]);
    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(exit.value.at(-1), { _tag: "Starting", updateId: "0123456789abcdef" });
    const downloading = exit.value.filter((step) => step._tag === "Downloading").at(-1);
    assert.deepEqual(downloading, { _tag: "Downloading", received: Buffer.byteLength(RELEASE), total: Buffer.byteLength(RELEASE) });
    const staged = updatePaths(file).staged(NEW);
    assert.deepEqual(asked, [{ version: NEW, path: staged, sha256: sha256(RELEASE), signature: null }]);
    assert.equal(await readFile(staged, "utf8"), RELEASE);
    // Handed over: the server stops in a moment, so nothing else may start.
    assert.equal((await statusOf(server, token)).blocker, "updating");
  });
});

test("two clients asking at once follow one update", async () => {
  await withUpdates({}, async ({ server, asked }) => {
    const [first, second] = await Promise.all([updateTo(server, await session(server)), updateTo(server, await session(server))]);
    for (const exit of [first, second]) assert.ok(Exit.isSuccess(exit) && exit.value.at(-1)?._tag === "Starting", failure(exit));
    assert.equal(asked.length, 1);
  });
});

for (const [name, release, why] of [
  ["a checksum that doesn't match", { checksum: "0".repeat(64) }, /didn't match its checksum, so nothing was installed/],
  ["a release that isn't there", { status: 404 }, /GitHub answered 404/],
  ["a redirect away from GitHub", { redirectTo: "http://example.com/runnerbox.js" }, /sent to example\.com, which isn't GitHub/],
] as const) {
  test(`${name} installs nothing and leaves no download behind`, async () => {
    await withUpdates({ release }, async ({ server, file, asked }) => {
      const token = await session(server);
      assert.match(failure(await updateTo(server, token)), why);
      assert.deepEqual(asked, []);
      assert.ok(!existsSync(updatePaths(file).staged(NEW)));
      assert.ok(!existsSync(`${updatePaths(file).staged(NEW)}.part`));
      // And the next attempt isn't held up by this one.
      assert.equal((await statusOf(server, token)).blocker, null);
    });
  });
}

test("a supervisor's refusal reaches the app in its own words, and the download goes", async () => {
  await withUpdates({ refuse: "The new version won't run on this machine. SyntaxError: this needs Node 99" }, async ({ server, file }) => {
    assert.match(failure(await updateTo(server, await session(server))), /won't run on this machine\. SyntaxError: this needs Node 99/);
    assert.ok(!existsSync(updatePaths(file).staged(NEW)));
  });
});

test("an update never goes back, and never to a version that isn't a release", async () => {
  await withUpdates({}, async ({ server, asked }) => {
    const token = await session(server);
    // Tests run as 0.0.0, the version of a build from a checkout.
    assert.match(failure(await updateTo(server, token, "0.0.0")), /isn't newer\. An update never goes back/);
    // The client's own schema refuses a version that isn't a release before it's sent.
    await assert.rejects(updateTo(server, token, "latest"), /Schema validation failed/);
    assert.deepEqual(asked, []);
  });
});

test("a build from a checkout, or a server not started by runnerbox serve, can't update", async () => {
  await withUpdates({ source: "none" }, async ({ server }) => {
    const token = await session(server);
    assert.equal((await statusOf(server, token)).blocker, "checkout");
    assert.match(failure(await updateTo(server, token)), /built from a checkout/);
  });
  await withUpdates({ supervised: false }, async ({ server }) => {
    assert.equal((await statusOf(server, await session(server))).blocker, "unsupervised");
  });
});

test("only a session with access:write can update, so never Connect's or an MCP token's", async () => {
  await withUpdates({}, async ({ server, asked }) => {
    // MCP_SCOPES are what a Connect session and an MCP token get.
    const readOnly = await session(server, MCP_SCOPES);
    assert.match(failure(await updateTo(server, readOnly)), /missing the access:write scope/);
    const status = await Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, readOnly), ({ client }) => Effect.exit(client["server.updateStatus"]()))));
    assert.match(failure(status), /missing the access:write scope/);
    assert.deepEqual(asked, []);
  });
});

test("a running turn holds an update back, with what to do about it", async () => {
  const provider = makeFakeProvider({ turns: [[{ text: "Working " }, { hang: true }]] });
  await withUpdates(
    {},
    async ({ server, asked }) => {
      const token = await session(server);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { client } = yield* openSession(server.baseUrl, token);
            const [item] = (yield* client["inbox.list"]({ days: 14 })).items;
            assert.ok(item);
            const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: item.id }, days: 14 });
            yield* client["threads.startTurn"]({ id: thread.id, text: "Why?" });
          }),
        ),
      );
      assert.equal((await statusOf(server, token)).blocker, "turn-running");
      assert.match(failure(await updateTo(server, token)), /The agent is answering in a thread\. Stop it, then update\./);
      assert.deepEqual(asked, []);
    },
    provider,
  );
});

test("a monitor's look holds an update back as a turn does, and says it's a monitor", async () => {
  const provider = makeFakeProvider({ turns: [[{ text: "Looking" }, { hang: true }]] });
  await withUpdates(
    {},
    async ({ server, asked }) => {
      const token = await session(server);
      const call = <A, E>(use: (client: Effect.Success<ReturnType<typeof openSession>>["client"]) => Effect.Effect<A, E>) =>
        Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));
      const on = { enabled: true, dailyLimit: 5, accountId: null, model: null };
      await call((client) => client["monitors.save"](on));
      // As though one of the fixtures' "Needs you" items had just appeared: the monitor forgets it saw it.
      const statePath = join(server.stateDir, ".server", "monitor.json");
      const state = JSON.parse(await readFile(statePath, "utf8"));
      delete state.seen["failure:owner/name\u0000ci\u0000test:infra"];
      await writeFile(statePath, JSON.stringify(state));
      const pass = server.checkMonitors();
      while (provider.inputs.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal((await statusOf(server, token)).blocker, "monitor-running");
      assert.match(failure(await updateTo(server, token)), /A monitor is looking into an item, which counts as an agent's turn/);
      // Turning monitors off stops the look, so the server closes with nothing running.
      await call((client) => client["monitors.save"]({ ...on, enabled: false }));
      await pass;
      assert.deepEqual(asked, []);
    },
    provider,
  );
});

// Asks a question in a new thread, and says how it went.
const ask = (server: Awaited<ReturnType<typeof startTestServer>>, token: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* openSession(server.baseUrl, token);
        const [item] = (yield* client["inbox.list"]({ days: 14 })).items;
        assert.ok(item);
        const thread = yield* client["threads.create"]({ subject: { _tag: "inbox", itemId: item.id }, days: 14 });
        return yield* Effect.exit(client["threads.startTurn"]({ id: thread.id, text: "Why?" }));
      }),
    ),
  );

test("once an update is handed over, no new turn starts for the restart to cut", async () => {
  await withUpdates(
    {},
    async ({ server }) => {
      const token = await session(server);
      assert.ok(Exit.isSuccess(await updateTo(server, token)));
      assert.match(failure(await ask(server, token)), /restarting on a new version\. Ask again in a moment/);
    },
    makeFakeProvider({ turns: [[{ text: "Because." }]] }),
  );
});

test("an update the supervisor refuses lets turns start again", async () => {
  await withUpdates(
    { refuse: "The new version won't run on this machine. SyntaxError: this needs Node 99" },
    async ({ server }) => {
      const token = await session(server);
      assert.ok(Exit.isFailure(await updateTo(server, token)));
      assert.ok(Exit.isSuccess(await ask(server, token)), "the turn started");
    },
    makeFakeProvider({ turns: [[{ text: "Because." }]] }),
  );
});

// A throwaway signing key, made for the test, and the signature it gives a release.
const throwawayKey = (id: string) => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key: ReleaseKey = { id, publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() };
  return { key, sign: (version: string, checksum = sha256(RELEASE)) => cryptoSign(null, Buffer.from(releaseMessage(version, checksum)), privateKey).toString("base64") };
};

test("with a key it trusts, a server installs a release signed by it, and hands the signature on", async () => {
  const signer = throwawayKey("current");
  const signature = signer.sign(NEW);
  await withUpdates({ keys: [signer.key], release: { signature } }, async ({ server, asked }) => {
    const token = await session(server);
    assert.deepEqual(await Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => client["server.checkRelease"]({ version: NEW })))), { signature: "valid" });
    assert.ok(Exit.isSuccess(await updateTo(server, token)));
    assert.equal(asked[0]?.signature, signature);
  });
});

test("while keys are rotated, a release signed by either key in the list installs", async () => {
  const [old, next] = [throwawayKey("old"), throwawayKey("next")];
  for (const signer of [old, next]) {
    await withUpdates({ keys: [old.key, next.key], release: { signature: signer.sign(NEW) } }, async ({ server }) => {
      assert.ok(Exit.isSuccess(await updateTo(server, await session(server))));
    });
  }
});

for (const [name, signature, check, why] of [
  ["no signature", undefined, "missing", /This release isn't signed, so it can't be installed from here\. Run the command on the machine instead\./],
  ["a signature by a key it doesn't trust", throwawayKey("stranger").sign(NEW), "invalid", /isn't by a key this server trusts/],
  ["a signature for another version", "other-version", "invalid", /isn't by a key this server trusts/],
  ["a signature over another file", "other-file", "invalid", /isn't by a key this server trusts/],
] as const) {
  test(`with a key it trusts, a server refuses a release with ${name} before downloading it`, async () => {
    const signer = throwawayKey("current");
    const text = signature === "other-version" ? signer.sign("0.3.1") : signature === "other-file" ? signer.sign(NEW, "0".repeat(64)) : signature;
    await withUpdates({ keys: [signer.key], release: text === undefined ? {} : { signature: text } }, async ({ server, file, asked }) => {
      const token = await session(server);
      assert.deepEqual(await Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => client["server.checkRelease"]({ version: NEW })))), { signature: check });
      assert.match(failure(await updateTo(server, token)), why);
      assert.deepEqual(asked, []);
      assert.ok(!existsSync(`${updatePaths(file).staged(NEW)}.part`), "nothing was downloaded");
    });
  });
}

test("a server that trusts no key yet asks for no signature", async () => {
  await withUpdates({}, async ({ server, asked }) => {
    const token = await session(server);
    assert.deepEqual(await Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => client["server.checkRelease"]({ version: NEW })))), { signature: "not-required" });
    assert.ok(Exit.isSuccess(await updateTo(server, token)));
    assert.equal(asked[0]?.signature, null);
  });
});
