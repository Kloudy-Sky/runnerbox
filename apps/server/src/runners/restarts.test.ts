import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, MCP_SCOPES } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { startFakeUp } from "../testing/fakeUp.ts";
import { writeFixtures } from "../testing/fixtures.ts";
import { startTestServer } from "../testing/testServer.ts";

type Server = Awaited<ReturnType<typeof startTestServer>>;
type Client = Effect.Success<ReturnType<typeof openSession>>["client"];

// A server over the fixtures, with the example install's real control socket and change logic.
async function withUp(body: (server: Server, up: Awaited<ReturnType<typeof startFakeUp>>) => Promise<void>) {
  const stateDir = await mkdtemp(join(tmpdir(), "rbx-"));
  await writeFixtures(stateDir, Date.now());
  const server = await startTestServer({ stateDir });
  const up = await startFakeUp(join(stateDir, "example"));
  try {
    await body(server, up);
  } finally {
    await up.close();
    await server.close();
    await rm(stateDir, { recursive: true, force: true });
  }
}

const session = async (server: Server, label: string, scopes: ReadonlyArray<AuthScope> = ALL_SCOPES) => {
  const { code } = await server.createPairingCode(scopes);
  return (await Effect.runPromise(pairWithCode(server.baseUrl, code, label))).token;
};
const withClient = <A, E>(server: Server, token: string, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(use(client)))));
const value = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
  return exit.value;
};

test("the owner's restart waits on the machine, every client sees it, a second is refused, and it ends as the machine says", async () => {
  await withUp(async (server, up) => {
    const [desktop, laptop] = [await session(server, "desktop"), await session(server, "laptop")];
    const before = value(await withClient(server, desktop, (client) => client["runners.restartStatus"]({ install: "example" })));
    assert.deepEqual(before, { install: "example", available: true, unavailable: null, waiting: null, last: null });

    const asked = value(await withClient(server, desktop, (client) => client["runners.restartWhenIdle"]({ install: "example" })));
    assert.equal(asked.waiting?.requestedBy, "desktop");
    // Another client sees the same waiting restart, and can't add a second.
    assert.equal(value(await withClient(server, laptop, (client) => client["runners.restartStatus"]({ install: "example" }))).waiting?.requestedBy, "desktop");
    const again = await withClient(server, laptop, (client) => client["runners.restartWhenIdle"]({ install: "example" }));
    assert.ok(Exit.isFailure(again));
    assert.match(Cause.pretty(again.cause), /A restart is already waiting\./);

    // The machine finds no job running.
    await up.changes.check();
    assert.equal(up.drains.length, 1);
    const after = value(await withClient(server, laptop, (client) => client["runners.restartStatus"]({ install: "example" })));
    assert.equal(after.waiting, null);
    assert.equal(after.last?.outcome, "restarted");
  });
});

test("only a session with access:write can restart runners, so never Connect's or an MCP token's", async () => {
  await withUp(async (server, up) => {
    const readOnly = await session(server, "connect", MCP_SCOPES);
    for (const ask of [(client: Client) => client["runners.restartWhenIdle"]({ install: "example" }), (client: Client) => client["runners.restartStatus"]({ install: "example" })]) {
      const exit = await withClient(server, readOnly, ask);
      assert.ok(Exit.isFailure(exit));
      assert.match(Cause.pretty(exit.cause), /missing the access:write scope/);
    }
    assert.deepEqual(up.drains, []);
  });
});

test("an install the server can't ask, such as one whose Runnerbox isn't running, is shown with its command and no reason", async () => {
  await withUp(async (server) => {
    const status = value(await withClient(server, await session(server, "desktop"), (client) => client["runners.restartStatus"]({ install: "elsewhere" })));
    assert.deepEqual(status, { install: "elsewhere", available: false, unavailable: null, waiting: null, last: null });
  });
});

test("an install whose config doesn't turn on changes says so beside its command", async () => {
  await withUp(async (server) => {
    // As `up` runs an install without `"changes": true`: a control socket with no change logic.
    const { listenForControl } = await import("runnerbox/src/control/socket.ts");
    const control = await listenForControl(join(server.stateDir, "nochanges"), { reproducer: null, changes: null });
    try {
      const status = value(await withClient(server, await session(server, "desktop"), (client) => client["runners.restartStatus"]({ install: "nochanges" })));
      assert.deepEqual(status, { install: "nochanges", available: false, unavailable: "To restart these from here, turn on changes in this machine's Runnerbox config.", waiting: null, last: null });
    } finally {
      control.close();
    }
  });
});
