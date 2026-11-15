import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { appliedProblems, appServerArgs, supportedVersion, threadStartParams, TOKEN_ENV } from "./codexAppServer.ts";
import { codexEnv } from "./codexCommand.ts";
import { findCodex } from "./CodexAdapter.ts";

// Against the `codex` installed here, when it's a release the adapter supports: the app server takes
// every setting, says it applied them, and reaches only Runnerbox's MCP server with the turn's token.
// It stops after `thread/start`, so nothing is signed in and no model is called. CI has no `codex`.
const codex = findCodex();
const version = codex === null ? "" : execFileSync(codex, ["--version"], { encoding: "utf8" });

test("the installed Codex takes Runnerbox's settings and applies them, before any model call", { skip: codex === null || !supportedVersion(version) ? "no supported codex installed" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-codex-installed-"));
  const seen: Array<{ readonly authorization: string | undefined; readonly method: string }> = [];
  const mcp = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = body === "" ? {} : JSON.parse(body);
      seen.push({ authorization: request.headers.authorization, method: message.method ?? request.method });
      if (message.id === undefined) return response.writeHead(request.method === "POST" ? 202 : 405).end();
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test", version: "0" } } : { tools: [] };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => mcp.listen(0, "127.0.0.1", resolve));
  const turn = { mcpUrl: `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`, propose: false, reproduce: false };
  const home = join(dir, "home");
  const cwd = join(dir, "cwd");
  await mkdir(home, { mode: 0o700 });
  await mkdir(cwd);
  const child = spawn(codex!, appServerArgs(turn), { cwd, env: { ...codexEnv(process.env, home), [TOKEN_ENV]: "turn-token-example" }, detached: true });
  try {
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "runnerbox", version: "1" }, capabilities: { experimentalApi: true } } });
    let applied: Parameters<typeof appliedProblems>[0] | undefined;
    for await (const line of createInterface({ input: child.stdout })) {
      const message = JSON.parse(line);
      if (message.id === 1) {
        assert.equal(message.error, undefined);
        send({ method: "initialized" });
        send({ id: 2, method: "thread/start", params: threadStartParams({ cwd, systemPrompt: "Example.", model: undefined }) });
      }
      if (message.id === 2) {
        assert.equal(message.error, undefined, JSON.stringify(message.error));
        applied = message.result;
        break;
      }
    }
    assert.ok(applied);
    assert.deepEqual(appliedProblems(applied), []);
    assert.ok(seen.length > 0 && seen.every((each) => each.authorization === "Bearer turn-token-example"), "only Runnerbox's server, with the turn's token");
  } finally {
    process.kill(-child.pid!, "SIGKILL");
    mcp.close();
    await rm(dir, { recursive: true, force: true });
  }
});
