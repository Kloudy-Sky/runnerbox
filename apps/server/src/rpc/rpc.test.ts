import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { issueTicket, openSession, pairWithCode } from "@runnerbox/client-runtime";
import type { AuthScope } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import { createJobLog } from "runnerbox/src/tracking/job-log.ts";
import { summarizeJobs } from "runnerbox/src/tracking/report.ts";
import { startTestServer } from "../testing/testServer.ts";

let server: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const pairAs = async (scopes: ReadonlyArray<AuthScope>, label = "test") => {
  const { code } = await server.createPairingCode(scopes);
  return Effect.runPromise(pairWithCode(server.baseUrl, code, label));
};

// Runs `use` with an RPC client for `token`, so each test opens and closes its own socket.
const withClient = <A, E>(token: string, use: (client: Effect.Success<ReturnType<typeof openSession>>["client"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => use(client))));

test("job summaries over the socket match what the core computes from the same log", async () => {
  const { token } = await pairAs(["history:read"]);
  const remote = await withClient(token, (client) => client["history.jobSummaries"]({ repo: "owner/name", days: 7, by: "labels" }));
  const since = Date.now() - 7 * 24 * 60 * 60_000;
  const records = (await createJobLog(join(server.stateDir, "owner__name.ndjson")).read()).filter(
    (record) => Date.parse(record.createdAt) >= since,
  );
  const local = summarizeJobs(records);
  assert.deepEqual(
    remote.map(({ job, runnerType, ran, failed, p50Ms }) => ({ job, runnerType, ran, failed, p50Ms })),
    local.map(({ job, runnerType, ran, failed, p50Ms }) => ({ job, runnerType, ran, failed, p50Ms })),
  );
  assert.ok(remote.some((row) => row.vmLowP50MiB !== null), "self-hosted rows join the install's samples");
});

test("each call is checked against the session's scopes", async () => {
  const { token } = await pairAs(["runners:read"]);
  const result = await withClient(token, (client) =>
    Effect.all({
      events: client["runners.events"]({ days: 7 }),
      runs: Effect.flip(client["history.runs"]({ repo: "owner/name", days: 7, limit: 10 })),
      // The inbox reads history, so runner access alone isn't enough.
      inbox: Effect.flip(client["inbox.list"]({ days: 7 })),
      sessions: Effect.flip(client["access.sessions"]()),
    }),
  );
  assert.ok(result.events.length > 0);
  assert.equal(result.runs._tag, "AuthorizationError");
  assert.equal(result.inbox._tag === "AuthorizationError" && result.inbox.requiredScope, "history:read");
  assert.equal(result.sessions._tag === "AuthorizationError" && result.sessions.requiredScope, "access:write");
});

test("a session can only delegate scopes it holds, and a revoked session can't open a socket", async () => {
  const admin = await pairAs(["history:read", "access:write"]);
  const reader = await pairAs(["history:read"], "to revoke");
  const outcome = await withClient(admin.token, (client) =>
    Effect.gen(function* () {
      const widened = yield* Effect.flip(client["access.createPairingCode"]({ scopes: ["runners:read"] }));
      const narrowed = yield* client["access.createPairingCode"]({ scopes: ["history:read"] });
      const sessions = yield* client["access.sessions"]();
      const victim = sessions.find((session) => session.label === "to revoke");
      yield* client["access.revokeSession"]({ id: victim!.id });
      return { widened, narrowed, listed: sessions.some((session) => "token" in session || "tokenHash" in session) };
    }),
  );
  assert.equal(outcome.widened._tag === "AccessError" && outcome.widened.reason, "scope_not_held");
  assert.deepEqual(outcome.narrowed.scopes, ["history:read"]);
  assert.equal(outcome.listed, false, "the access list never carries a credential");
  const refused = await Effect.runPromise(Effect.flip(issueTicket(server.baseUrl, reader.token)));
  assert.equal(refused.reason, "unauthorized");
});

test("a pairing code works once, and a WebSocket ticket opens one socket", async () => {
  const { code } = await server.createPairingCode(["history:read"]);
  const first = await Effect.runPromise(pairWithCode(server.baseUrl, code.toLowerCase(), "test"));
  assert.deepEqual(first.scopes, ["history:read"]);
  const second = await Effect.runPromise(Effect.flip(pairWithCode(server.baseUrl, code, "test")));
  assert.equal(second.reason, "pairing_rejected");

  const { ticket } = await Effect.runPromise(issueTicket(server.baseUrl, first.token));
  const url = `${server.baseUrl.replace("http", "ws")}/ws?ticket=${ticket}`;
  const opens = async () =>
    new Promise<boolean>((resolve) => {
      const socket = new WebSocket(url);
      socket.onopen = () => {
        socket.close();
        resolve(true);
      };
      socket.onerror = () => resolve(false);
    });
  assert.equal(await opens(), true);
  assert.equal(await opens(), false);
});
