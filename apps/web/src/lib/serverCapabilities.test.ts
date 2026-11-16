import assert from "node:assert/strict";
import { test } from "node:test";
import { RPC_METHODS } from "@runnerbox/contracts";
import { capabilitiesOf, NO_CAPABILITIES } from "./serverCapabilities.ts";

test("a server older than the question offers none of the newer controls, and a current one all of them", () => {
  assert.deepEqual(capabilitiesOf(null), NO_CAPABILITIES);
  assert.deepEqual(capabilitiesOf(Object.values(RPC_METHODS)), { models: true, attachments: true, references: true, queue: true, deleteThread: true, providers: true, jobResources: true, waitingJobs: true, serverUpdate: true, speed: true, runnersExplained: true, checkRelease: true, restartRunners: true, reviews: true });
  // A server that answers but leaves one out: that control alone goes.
  const withoutQueue = Object.values(RPC_METHODS).filter((method) => method !== RPC_METHODS.threadsQueueTurn);
  assert.equal(capabilitiesOf(withoutQueue).queue, false);
  assert.equal(capabilitiesOf(withoutQueue).attachments, true);
});
