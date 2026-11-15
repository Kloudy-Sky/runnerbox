import assert from "node:assert/strict";
import { test } from "node:test";
import { codexEnv } from "./codexCommand.ts";

test("codex gets Runnerbox's own home, and never a key, home or endpoint from the server's environment", () => {
  const server = { PATH: "/usr/bin", HOME: "/home/example", OPENAI_API_KEY: "ambient", CODEX_API_KEY: "ambient", CODEX_HOME: "/home/example/.codex", OPENAI_BASE_URL: "https://example.com", LC_ALL: "C" };
  assert.deepEqual(codexEnv(server, "/state/.server/agent/codex-home"), { PATH: "/usr/bin", HOME: "/home/example", LC_ALL: "C", CODEX_HOME: "/state/.server/agent/codex-home" });
});
