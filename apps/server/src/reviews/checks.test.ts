import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerPaths from "../config/ServerPaths.ts";
import * as StateLogs from "../history/StateLogs.ts";
import * as QueueConfig from "../runners/QueueConfig.ts";
import { checksOf, jobOfRecord, jobsOf } from "./commitChecks.ts";
import * as PullChecks from "./PullChecks.ts";

const TOKEN = "not-a-real-token";
const TIMING = { pollMs: 50, slowMs: 300, maxBackoffMs: 400, idleMs: 200, checkMs: 20 };
const job = (name: string, attempt: number, status: string, conclusion: string | null) => ({
  run_id: 5,
  run_attempt: attempt,
  workflow_name: "ci",
  name,
  status,
  conclusion,
  started_at: "2026-11-15T10:00:00Z",
  completed_at: conclusion === null ? null : "2026-11-15T10:02:00Z",
});

test("a job from history and the same job from GitHub show once, at its newest attempt", () => {
  const recorded = (name: string, conclusion: string) =>
    jobOfRecord({ v: 1, repo: "owner/name", workflow: "ci", job: name, jobId: 1, runId: 5, attempt: 1, branch: "main", headSha: "a".repeat(40), conclusion, runner: "example-1", labels: ["example-linux"], createdAt: "2026-11-15T09:59:00Z", startedAt: "2026-11-15T10:00:00Z", completedAt: "2026-11-15T10:02:00Z", steps: [] });
  const fromGitHub = jobsOf({ jobs: [job("test", 1, "completed", "success"), job("lint", 2, "in_progress", null)] });
  assert.ok(fromGitHub !== null);
  assert.deepEqual(checksOf([recorded("test", "success"), recorded("lint", "failure"), ...fromGitHub]), [
    { name: "lint", workflow: "ci", state: "running", startedAt: "2026-11-15T10:00:00Z", durationMs: null },
    { name: "test", workflow: "ci", state: "passed", startedAt: "2026-11-15T10:00:00Z", durationMs: 120_000 },
  ]);
});

test("a run that ended has its jobs fetched once, and a re-run of it still shows", async () => {
  const sha = "e".repeat(40);
  // The run's current attempt: 1 failed and ended, until the test re-runs it as 2.
  let attempt = 1;
  const asked: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    asked.push(path);
    const reply = path.includes(`head_sha=${sha}`)
      ? { workflow_runs: [{ id: 5, run_attempt: attempt, status: attempt === 1 ? "completed" : "in_progress" }] }
      : { jobs: [attempt === 1 ? job("test", 1, "completed", "failure") : job("test", 2, "in_progress", null)] };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const apiBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-checks-"));
  const layer = PullChecks.layer.pipe(Layer.provide(StateLogs.layer), Layer.provide(ServerPaths.layer(stateDir)), Layer.provide(QueueConfig.layerTest({ apiBase, reportEnvPath: "/nonexistent/report.env", timing: TIMING })));
  const commit = { repo: "owner/name", headSha: sha };
  const jobsAsked = () => asked.filter((path) => path.includes("/runs/5/jobs")).length;
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const checks = yield* PullChecks.PullChecks;
        const look = (at: number) => checks.of([commit], TOKEN, at).pipe(Effect.map((checksOf) => checksOf(commit).map((check) => check.state)));
        assert.deepEqual(yield* look(1), ["failed"]);
        assert.deepEqual(yield* look(2), ["failed"]);
        assert.equal(jobsAsked(), 1);
        attempt = 2;
        assert.deepEqual(yield* look(3), ["running"]);
        assert.equal(jobsAsked(), 2);
      }).pipe(Effect.provide(layer)),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(stateDir, { recursive: true, force: true });
  }
});
