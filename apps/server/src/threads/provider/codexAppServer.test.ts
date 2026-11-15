import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTools, appliedProblems, appServerArgs, launchProblems, mcpProblems, providerProblems, supportedVersion, threadStartParams, TOKEN_ENV } from "./codexAppServer.ts";
import { loginHomeProblem } from "./loginHome.ts";

const turn = { mcpUrl: "http://127.0.0.1:4517/mcp", propose: true, reproduce: false, ownerServers: ["docs", "team.tools"] };
const args = appServerArgs(turn);
const params = threadStartParams({ cwd: "/state/.server/agent/cwd", systemPrompt: "Example.", model: undefined });

test("a turn missing any setting that holds Codex to Runnerbox's tools is refused before codex starts", () => {
  assert.deepEqual(launchProblems(turn, args, params), []);
  // Each setting is a flag and its value; dropping either pair from the command is caught.
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "-c" && args[index] !== "--disable") continue;
    const without = [...args.slice(0, index), ...args.slice(index + 2)];
    assert.notDeepEqual(launchProblems(turn, without, params), [], `without ${args[index + 1]}`);
  }
  for (const [key, value] of [["sandbox", "workspace-write"], ["approvalPolicy", "never"], ["approvalsReviewer", "auto_review"], ["ephemeral", false]] as const) {
    assert.deepEqual(launchProblems(turn, args, { ...params, [key]: value }), [`${key}=${String(params[key])}`]);
  }
});

test("the token travels only as the name of an environment variable, and each turn's tools are its own", () => {
  assert.ok(args.includes(`mcp_servers.runnerbox.bearer_token_env_var="${TOKEN_ENV}"`));
  assert.ok(!args.some((arg) => /bearer|authorization/i.test(arg) && !arg.includes("bearer_token_env_var")));
  const tools = (options: { propose: boolean; reproduce: boolean }) => allowedTools(options);
  assert.ok(!tools({ propose: false, reproduce: false }).includes("propose_change"));
  assert.ok(tools({ propose: true, reproduce: false }).includes("propose_change"));
  assert.ok(!tools({ propose: true, reproduce: false }).includes("repro_exec"));
  assert.ok(tools({ propose: true, reproduce: true }).includes("repro_exec"));
});

test("what Codex says it applied must match: approvals to Runnerbox, read-only without network, no instructions", () => {
  const applied = { approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false }, instructionSources: [] };
  assert.deepEqual(appliedProblems(applied), []);
  assert.equal(appliedProblems({ ...applied, approvalPolicy: "never" }).length, 1);
  assert.equal(appliedProblems({ ...applied, approvalsReviewer: "auto_review" }).length, 1);
  assert.equal(appliedProblems({ ...applied, sandbox: { type: "readOnly", networkAccess: true } }).length, 1);
  assert.equal(appliedProblems({ ...applied, sandbox: { type: "dangerFullAccess" } }).length, 1);
  assert.equal(appliedProblems({ ...applied, instructionSources: ["/home/example/AGENTS.md"] }).length, 1);
});

test("only the Codex releases the adapter was checked against run", () => {
  assert.ok(supportedVersion("codex-cli 0.167.2"));
  assert.ok(supportedVersion("codex-cli 0.167.9"));
  assert.ok(!supportedVersion("codex-cli 0.167.1"));
  assert.ok(!supportedVersion("codex-cli 0.168.0"));
  assert.ok(!supportedVersion("not a version"));
});

test("Codex's MCP servers must be Runnerbox's alone, with this turn's tools, and every other one off", () => {
  const allowed = allowedTools({ propose: false, reproduce: false });
  const runnerbox = { name: "runnerbox", runtimeStatus: "connected", tools: { ci_overview: {} } };
  assert.deepEqual(mcpProblems({ data: [runnerbox, { name: "docs", runtimeStatus: "disabled", tools: {} }] }, allowed), []);
  assert.equal(mcpProblems({ data: [runnerbox, { name: "docs", runtimeStatus: "ready", tools: {} }] }, allowed).length, 1);
  assert.equal(mcpProblems({ data: [runnerbox, { name: "docs", runtimeStatus: "disabled", tools: { search: {} } }] }, allowed).length, 1);
  assert.equal(mcpProblems({ data: [{ ...runnerbox, tools: { propose_change: {} } }] }, allowed).length, 1, "a monitor's turn isn't given propose_change");
  assert.equal(mcpProblems({ data: [runnerbox], nextCursor: "more" }, allowed).length, 1, "a list it can't see the end of isn't trusted");
  assert.deepEqual(mcpProblems({ data: [] }, allowed), ["Runnerbox's MCP server isn't connected"]);
  assert.deepEqual(mcpProblems({ data: [{ ...runnerbox, runtimeStatus: "starting" }] }, allowed), ["Runnerbox's MCP server isn't connected"]);
});

test("turns go only to the built-in OpenAI provider at its own address", () => {
  assert.ok(args.includes('model_provider="openai"'));
  assert.deepEqual(providerProblems({ config: { model_provider: "openai", openai_base_url: null, chatgpt_base_url: "https://chatgpt.com/backend-api/" } }), [], "Codex's own default, which it fills in for every home");
  assert.equal(providerProblems({ config: { model_provider: "custom" } }).length, 1);
  for (const key of ["openai_base_url", "chatgpt_base_url", "experimental_realtime_ws_base_url", "experimental_realtime_webrtc_call_base_url"]) {
    assert.equal(providerProblems({ config: { model_provider: "openai", [key]: "https://example.com" } }).length, 1, key);
  }
  assert.equal(providerProblems({ config: { model_provider: "openai", model_providers: { openai: { model_catalog_url: "https://example.com" } } } }).length, 1);
  const applied = { approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false }, instructionSources: [] };
  assert.equal(appliedProblems({ ...applied, modelProvider: "custom" }).length, 1);
});

test("an owner's home must be a directory of the server's own user that nobody else can write", () => {
  assert.equal(loginHomeProblem("/home/example/.codex", { isDirectory: true, uid: 501, mode: 0o40755 }, 501), null);
  assert.match(loginHomeProblem("/tmp/x", { isDirectory: true, uid: 502, mode: 0o40700 }, 501) ?? "", /another user/);
  assert.match(loginHomeProblem("/home/example/.codex", { isDirectory: true, uid: 501, mode: 0o40775 }, 501) ?? "", /other users can write/);
  assert.match(loginHomeProblem("/home/example/.codex", { isDirectory: true, uid: 501, mode: 0o40757 }, 501) ?? "", /other users can write/);
  assert.match(loginHomeProblem("/nowhere", null, 501) ?? "", /no home/);
});
