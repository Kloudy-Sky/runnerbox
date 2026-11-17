import assert from "node:assert/strict";
import { test } from "node:test";
import { createLastLine, LAST_LINE_MAX } from "./last-line.ts";

test("keeps the last line that says why, across chunks, without Docker's help hint", () => {
  const lastLine = createLastLine();
  lastLine.push("docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. ");
  lastLine.push("Is the docker daemon running?\n\n\u001b[2mRun 'docker run --help' for more information\u001b[0m\n");
  assert.equal(lastLine.last(), "docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?");
});

test("a line without its newline counts, control characters go, and it's cut short", () => {
  const lastLine = createLastLine();
  lastLine.push("first\n");
  lastLine.push(`run-job:\tfailed\u0007 ${"x".repeat(300)}`);
  const kept = lastLine.last();
  assert.equal(kept?.length, LAST_LINE_MAX);
  assert.match(kept ?? "", /^run-job: failed x+$/);
  assert.equal(createLastLine().last(), null);
});
