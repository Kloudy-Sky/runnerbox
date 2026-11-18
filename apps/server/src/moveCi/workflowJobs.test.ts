import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { unifiedDiff } from "./unifiedDiff.ts";
import { applyEdits, workflowJobs } from "./workflowJobs.ts";

const WORKFLOW = `name: ci
on: [push]
jobs:
  build:
    runs-on: \${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}
    steps:
      - run: make
  test:
    # Hosted for now.
    runs-on: "ubuntu-latest"  # keep this comment
    steps:
      - run: docker build -t app .
  integration:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgres
  mac:
    runs-on: macos-15
    steps:
      - uses: docker/setup-buildx-action@v3
  matrix:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-15]
    runs-on: \${{ matrix.os }}
  pinned:
    runs-on: [self-hosted, linux]
  windows:
    runs-on: windows-latest
  flow: { runs-on: ubuntu-latest, steps: [{ run: docker pull postgres }] }
  called:
    uses: ./.github/workflows/release.yml`;

test("each job's runner is sorted into moves, patched or left, and Docker use is flagged", () => {
  const scanned = workflowJobs(WORKFLOW);
  assert.ok(scanned);
  assert.deepEqual(scanned.jobs, [
    { job: "build", runsOn: "${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}", state: "moves", variable: "LINUX_RUNNER", docker: null },
    { job: "test", runsOn: '"ubuntu-latest"', state: "patched", variable: "LINUX_RUNNER", docker: "command" },
    { job: "integration", runsOn: "ubuntu-latest", state: "patched", variable: "LINUX_RUNNER", docker: "services" },
    { job: "mac", runsOn: "macos-15", state: "patched", variable: "MAC_RUNNER", docker: "action" },
    { job: "matrix", runsOn: "${{ matrix.os }}", state: "left", variable: null, docker: null },
    { job: "pinned", runsOn: "[self-hosted, linux]", state: "left", variable: null, docker: null },
    { job: "windows", runsOn: "windows-latest", state: "left", variable: null, docker: null },
    { job: "flow", runsOn: "ubuntu-latest", state: "patched", variable: "LINUX_RUNNER", docker: "command" },
  ]);
});

test("the patch applies with git apply, changes only the runners, keeps comments, and quotes where YAML needs it", async () => {
  const scanned = workflowJobs(WORKFLOW);
  assert.ok(scanned);
  const path = ".github/workflows/ci.yml";
  const patch = unifiedDiff(path, WORKFLOW, applyEdits(WORKFLOW, scanned.edits));
  const dir = await mkdtemp(join(tmpdir(), "move-ci-"));
  try {
    await mkdir(join(dir, ".github/workflows"), { recursive: true });
    await writeFile(join(dir, path), WORKFLOW);
    await writeFile(join(dir, "move.patch"), patch);
    execFileSync("git", ["apply", "move.patch"], { cwd: dir });
    const after = await readFile(join(dir, path), "utf8");
    assert.deepEqual(
      after.split("\n").filter((line, index) => line !== WORKFLOW.split("\n")[index]),
      [
        `    runs-on: "\${{ vars.LINUX_RUNNER || 'ubuntu-latest' }}"  # keep this comment`,
        "    runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-latest' }}",
        "    runs-on: ${{ vars.MAC_RUNNER || 'macos-15' }}",
        `  flow: { runs-on: "\${{ vars.LINUX_RUNNER || 'ubuntu-latest' }}", steps: [{ run: docker pull postgres }] }`,
      ],
    );
    // The patched file reads back as every job now moving, except the ones left alone.
    assert.deepEqual(workflowJobs(after)?.jobs.map((job) => job.state), ["moves", "moves", "moves", "moves", "left", "left", "left", "moves"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file that isn't a workflow GitHub could run lists nothing rather than guessing", () => {
  assert.equal(workflowJobs("jobs:\n  build:\n    runs-on: [ubuntu\n"), null);
  assert.equal(workflowJobs("name: no jobs here\n"), null);
});
