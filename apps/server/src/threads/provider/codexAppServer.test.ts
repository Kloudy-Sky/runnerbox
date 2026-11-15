import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTools, appliedProblems, appServerArgs, launchProblems, supportedVersion, threadStartParams, TOKEN_ENV } from "./codexAppServer.ts";

const turn = { mcpUrl: "http://127.0.0.1:4517/mcp", propose: true, reproduce: false };
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
