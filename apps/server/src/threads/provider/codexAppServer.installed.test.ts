import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { appliedProblems, appServerArgs, mcpProblems, providerProblems, supportedVersion, threadStartParams, TOKEN_ENV } from "./codexAppServer.ts";
import { codexEnv } from "./codexCommand.ts";
import { findCodex } from "./CodexAdapter.ts";

// Against the `codex` installed here, when it's a release the adapter supports: the app server takes
// every setting, says it applied them, and reaches only Runnerbox's MCP server with the turn's token.
// It stops after `thread/start`, so nothing is signed in and no model is called. CI has no `codex`.
const codex = findCodex();
const version = codex === null ? "" : execFileSync(codex, ["--version"], { encoding: "utf8" });

// A loopback MCP server standing in for Runnerbox's, with the given tools, that notes who called it.
async function startMcp(toolNames: ReadonlyArray<string> = []) {
  const seen: Array<{ readonly authorization: string | undefined; readonly method: string }> = [];
  const mcp = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = body === "" ? {} : JSON.parse(body);
      seen.push({ authorization: request.headers.authorization, method: message.method ?? request.method });
      if (message.id === undefined) return response.writeHead(request.method === "POST" ? 202 : 405).end();
      const tools = toolNames.map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } }));
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test", version: "0" } } : { tools };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => mcp.listen(0, "127.0.0.1", resolve));
  return { mcp, seen, url: `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp` };
}

test("the installed Codex takes Runnerbox's settings and applies them, before any model call", { skip: codex === null || !supportedVersion(version) ? "no supported codex installed" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-codex-installed-"));
  const { mcp, seen, url } = await startMcp();
  const turn = { mcpUrl: url, propose: false, reproduce: false, ownerServers: [] };
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
        send({ id: 3, method: "config/read", params: { cwd } });
      }
      if (message.id === 3) {
        assert.deepEqual(providerProblems(message.result), [], "a home with no config goes to the built-in provider at its default address");
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

// An owner's home, made up here: MCP servers, notify and developer instructions in its config.toml,
// a provider of their own with a base URL, and a global AGENTS.md. The overrides leave every server of theirs off, and the AGENTS.md, which no
// setting in 0.167 turns off, is reported as the one instruction file, which an owner's home may load.
test("against the installed Codex, an owner's MCP servers are off, and only their global AGENTS.md loads", { skip: codex === null || !supportedVersion(version) ? "no supported codex installed" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-codex-owner-"));
  const home = join(dir, "home");
  const cwd = join(dir, "cwd");
  await mkdir(home, { mode: 0o700 });
  await mkdir(cwd);
  await writeFile(join(home, "config.toml"), 'notify = ["/usr/bin/true"]\ndeveloper_instructions = "Example."\nmodel_provider = "custom"\nchatgpt_base_url = "https://example.com/chat"\n\n[model_providers.custom]\nname = "Custom"\nbase_url = "https://example.com/v1"\n\n[mcp_servers.docs]\ncommand = "/usr/bin/true"\n\n[mcp_servers."team.tools"]\nurl = "http://127.0.0.1:9/mcp"\n');
  await writeFile(join(home, "AGENTS.md"), "Example instructions.\n");
  const { mcp, url } = await startMcp();
  const turn = { mcpUrl: url, propose: false, reproduce: false, ownerServers: ["docs", "team.tools"] };
  const child = spawn(codex!, appServerArgs(turn), { cwd, env: { ...codexEnv(process.env, home), [TOKEN_ENV]: "turn-token-example" }, detached: true });
  try {
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "runnerbox", version: "1" }, capabilities: { experimentalApi: true } } });
    let applied: Parameters<typeof appliedProblems>[0] | undefined;
    let servers: Parameters<typeof mcpProblems>[0] | undefined;
    let config: Parameters<typeof providerProblems>[0] | undefined;
    for await (const line of createInterface({ input: child.stdout })) {
      const message = JSON.parse(line);
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "thread/start", params: threadStartParams({ cwd, systemPrompt: "Example.", model: undefined }) });
      }
      if (message.id === 2) {
        applied = message.result;
        send({ id: 3, method: "mcpServerStatus/list", params: { threadId: message.result.thread.id, limit: 100 } });
        send({ id: 4, method: "config/read", params: { cwd } });
      }
      if (message.id === 3) servers = message.result;
      if (message.id === 4) config = message.result;
      if (servers && config) break;
    }
    assert.deepEqual(
      servers?.data.filter((server) => server.name !== "runnerbox").map((server) => [server.name, server.runtimeStatus]),
      [
        ["docs", "disabled"],
        ["team.tools", "disabled"],
      ],
    );
    assert.deepEqual(mcpProblems(servers!, []), []);
    // The pin wins over the config's own provider; the base URL it sets can't be unset, so it's caught.
    assert.deepEqual(providerProblems(config!), ["its config sets `chatgpt_base_url`"]);
    assert.deepEqual(appliedProblems(applied!), ["it loaded instruction files"], "Runnerbox's own home allows none");
    // Codex names it by its resolved path, as the adapter allows: macOS's temp folder is behind a symlink.
    assert.deepEqual(appliedProblems(applied!, [join(home, "AGENTS.md"), join(realpathSync(home), "AGENTS.md")]), [], "an owner's home may load its global AGENTS.md");
  } finally {
    process.kill(-child.pid!, "SIGKILL");
    mcp.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// What the model would be offered, rendered by `codex debug prompt-input` without a model call, on a
// model whose catalog asks for code mode, as every current one does. Runnerbox's tools must be in its
// own tool list, called directly, with nothing deferred and no tool search.
test("against the installed Codex, Runnerbox's tools are in the model's own tool list, not deferred", { skip: codex === null || !supportedVersion(version) ? "no supported codex installed" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-codex-tools-"));
  const home = join(dir, "home");
  const cwd = join(dir, "cwd");
  await mkdir(home, { mode: 0o700 });
  await mkdir(cwd);
  const { mcp, url } = await startMcp(["ci_overview", "runner_state"]);
  const turn = { mcpUrl: url, propose: false, reproduce: false, ownerServers: [] };
  try {
    const rendered = await new Promise<string>((resolve, reject) =>
      execFile(codex!, ["debug", "prompt-input", ...appServerArgs(turn).slice(1), "-c", 'model="gpt-6-luna"', "hi"], { cwd, env: { ...codexEnv(process.env, home), [TOKEN_ENV]: "turn-token-example" }, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
    );
    const input: ReadonlyArray<{ type?: string; tools?: ReadonlyArray<{ type?: string; name?: string; tools?: ReadonlyArray<{ name?: string }> }> }> = JSON.parse(rendered);
    const offered = input.filter((item) => item.type === "additional_tools").flatMap((item) => item.tools ?? []);
    const names = offered.flatMap((tool) => (tool.type === "namespace" ? (tool.tools ?? []).map((nested) => `${tool.name}.${nested.name}`) : [String(tool.name)]));
    assert.ok(names.includes("mcp__runnerbox.ci_overview") && names.includes("mcp__runnerbox.runner_state"), names.join(", "));
    assert.ok(!rendered.includes("Deferred tool namespaces"), "nothing is deferred");
    assert.ok(!names.some((name) => /tool_search/.test(name)), "no tool search");
  } finally {
    mcp.close();
    await rm(dir, { recursive: true, force: true });
  }
});
