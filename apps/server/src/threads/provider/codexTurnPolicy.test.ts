import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTools } from "./codexAppServer.ts";
import { decide, type TurnState } from "./codexTurnPolicy.ts";

const owner = (): TurnState => ({ steps: 0, allowed: new Set(allowedTools({ propose: true, reproduce: false })), maxSteps: 12 });
const monitor = (): TurnState => ({ steps: 0, allowed: new Set(allowedTools({ propose: false, reproduce: false })), maxSteps: 12 });
const started = (item: Record<string, unknown>) => ({ method: "item/started", params: { item: { id: "i", ...item } } });
const call = (tool: string, server = "runnerbox") => started({ type: "mcpToolCall", server, tool, arguments: {} });

test("every request that would run something is declined in Codex's own words, and ends the turn", () => {
  const cases = [
    ["item/commandExecution/requestApproval", { decision: "decline" }],
    ["execCommandApproval", { decision: "denied" }],
    ["item/fileChange/requestApproval", { decision: "decline" }],
    ["applyPatchApproval", { decision: "denied" }],
    ["item/permissions/requestApproval", { permissions: {} }],
    ["item/tool/requestUserInput", { answers: {} }],
    ["mcpServer/elicitation/request", { action: "decline" }],
    ["item/tool/call", { contentItems: [], success: false }],
  ] as const;
  for (const [method, result] of cases) {
    const decision = decide({ id: 7, method, params: {} }, owner());
    assert.deepEqual(decision.reply, { id: 7, result }, method);
    assert.equal(decision.end?._tag, "Stopped", method);
  }
  const unknown = decide({ id: 8, method: "item/somethingNew/request", params: {} }, owner());
  assert.equal(unknown.reply?.error?.code, -32601);
  assert.equal(unknown.end?._tag, "Stopped");
});

test("only Runnerbox's allowed tools go through; another server's, or one this turn isn't given, ends it", () => {
  assert.deepEqual(decide(call("ci_overview"), owner()).events, [{ _tag: "ToolCall", name: "ci_overview", input: {} }]);
  assert.deepEqual(decide(call("propose_change"), owner()).events.map((event) => event._tag), ["ToolCall"]);
  assert.equal(decide(call("propose_change"), monitor()).end?._tag, "Stopped", "a monitor's turn can't propose");
  assert.equal(decide(call("repro_exec"), owner()).end?._tag, "Stopped", "no reproduce, no shell");
  assert.equal(decide(call("ci_overview", "elsewhere"), owner()).end?._tag, "Stopped");
});

test("any other item kind, an unknown one, or an unknown notification ends the turn; unknown never means allowed", () => {
  for (const type of ["commandExecution", "fileChange", "dynamicToolCall", "collabAgentToolCall", "subAgentActivity", "webSearch", "imageView", "sleep", "imageGeneration", "hookPrompt", "somethingNew"]) {
    assert.equal(decide(started({ type }), owner()).end?._tag, "Stopped", type);
  }
  assert.equal(decide(started({ type: "mcpToolCall", tool: "ci_overview" }), owner()).end?._tag, "Stopped", "a tool call missing its server isn't trusted");
  assert.equal(decide({ method: "turn/diff/updated", params: {} }, owner()).end?._tag, "Stopped");
  assert.equal(decide({ method: "thread/somethingNew", params: {} }, owner()).end?._tag, "Stopped");
  assert.equal(decide({ id: 3, result: {} }, owner()).end?._tag, "Stopped", "a response to nothing Runnerbox asked");
});

test("a turn ends after its step limit, and streams text, and ends done when Codex completes it", () => {
  const state = { ...owner(), maxSteps: 2 };
  assert.equal(decide(call("ci_overview"), state).end, undefined);
  assert.equal(decide(call("ci_overview"), state).end, undefined);
  assert.equal(decide(call("ci_overview"), state).end?._tag, "Stopped");
  assert.deepEqual(decide({ method: "item/agentMessage/delta", params: { delta: "The" } }, owner()).events, [{ _tag: "TextDelta", text: "The" }]);
  assert.deepEqual(decide({ method: "item/completed", params: { item: { id: "m", type: "agentMessage", text: "The machine." } } }, owner()).events, [{ _tag: "Text", text: "The machine." }]);
  assert.equal(decide({ method: "turn/completed", params: { turn: { status: "completed" } } }, owner()).end?._tag, "Done");
  assert.equal(decide({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "Over quota." } } } }, owner()).end?._tag, "Stopped");
  assert.equal(decide({ method: "error", params: { error: { message: "Reconnecting." }, willRetry: true } }, owner()).end, undefined);
});
