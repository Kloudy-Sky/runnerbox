import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProbe } from "./tool-probe.ts";

test("the probe's output becomes the build time and each known tool's version", () => {
  const output = [
    "2026-11-12T10:01:02.123456789Z",
    "os\tUbuntu",
    "osversion\t24.04",
    "node\tv24.11.1",
    "gh\tgh version 2.45.0 (2024-02-07)",
    "git\tgit version 2.43.0",
    "docker\t",
    "python\tPython 3.12.3",
    "aws\t",
    "runner\t2.338.2",
    "made-up\t9.9.9",
    "",
  ].join("\n");

  assert.deepEqual(parseProbe(output), {
    builtAt: "2026-11-12T10:01:02.123Z",
    tools: [
      { name: "Ubuntu", version: "24.04" },
      { name: "node", version: "24.11.1" },
      { name: "gh", version: "2.45.0" },
      { name: "git", version: "2.43.0" },
      { name: "docker", version: null },
      { name: "python", version: "3.12.3" },
      { name: "aws", version: null },
      { name: "runner", version: "2.338.2" },
    ],
  });
});

test("output the image garbled gives nulls, never a long or made-up value", () => {
  const { builtAt, tools } = parseProbe(`not a date\nos\t${"x".repeat(500)}\nosversion\t24.04; rm -rf /\ngh\tno version here\n`);
  assert.equal(builtAt, null);
  assert.equal(tools[0]?.name.length, 40);
  assert.equal(tools[0]?.version, null);
  assert.equal(tools.find((tool) => tool.name === "gh")?.version, null);
});
