import assert from "node:assert/strict";
import { test } from "node:test";
import { jobFromRunnerLine } from "./runner-output.ts";

test("only the runner's own line names the job it took", () => {
  assert.equal(jobFromRunnerLine("2026-11-15 03:00:00Z: Running job: ci / test"), "ci / test");
  assert.equal(jobFromRunnerLine("2026-11-15 03:00:00Z: Listening for Jobs"), null);
  assert.equal(jobFromRunnerLine("2026-11-15 03:05:00Z: Job test completed with result: Succeeded"), null);
  assert.equal(jobFromRunnerLine(`2026-11-15 03:00:00Z: Running job: ${"x".repeat(300)}`)?.length, 100);
});
