import assert from "node:assert/strict";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { startTestServer } from "../testing/testServer.ts";

const askMethods = async (server: Awaited<ReturnType<typeof startTestServer>>) => {
  const { code } = await server.createPairingCode(ALL_SCOPES);
  const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
  return Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(client["server.methods"]()))));
};

test("a server says which methods it answers, and one older than the question refuses it as unknown", async () => {
  const current = await startTestServer();
  const older = await startTestServer({ withoutMethods: ["server.methods", "threads.queueTurn"] });
  try {
    const answered = await askMethods(current);
    assert.ok(Exit.isSuccess(answered) && answered.value.includes("threads.queueTurn") && answered.value.includes("threads.stageAttachment"));
    const refused = await askMethods(older);
    assert.ok(Exit.isFailure(refused));
    assert.match(Cause.pretty(refused.cause), /Unknown request tag: server\.methods/);
  } finally {
    await current.close();
    await older.close();
  }
});
