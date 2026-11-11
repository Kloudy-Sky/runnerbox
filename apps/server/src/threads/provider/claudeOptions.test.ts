import assert from "node:assert/strict";
import { test } from "node:test";
import * as Context from "effect/Context";
import { Tool } from "effect/ai";
import { RunnerboxToolkit } from "../../mcp/tools.ts";
import type { AgentTools } from "../AgentTools.ts";
import { claudeOptions, toolName } from "./claudeOptions.ts";
import { type SdkTransport, sdkMcpServer } from "./sdkMcpServer.ts";

const toolkitTools = Object.values(RunnerboxToolkit.tools);
const tools: AgentTools = {
  definitions: toolkitTools.map((tool) => ({ name: tool.name, description: "", inputSchema: { type: "object" } })),
  call: async (name) => ({ text: `called ${name}`, isError: false }),
};
const options = claudeOptions({
  executable: "/usr/local/bin/claude",
  cwd: "/tmp/empty",
  model: undefined,
  systemPrompt: "prompt",
  tools,
  abortController: new AbortController(),
  env: { HOME: "/home/example" },
});

// What the agent in a thread can reach is decided entirely by these options. Each assertion is a
// boundary the threat model names.
test("the SDK gets no built-in tools and only runnerbox's read-only MCP tools", () => {
  assert.deepEqual(options.tools, [], "no shell, file, web, subagent or skill tools");
  assert.deepEqual(Object.keys(options.mcpServers ?? {}), ["runnerbox"]);
  assert.equal(options.mcpServers?.runnerbox?.type, "sdk", "in process, over the server's own services");
  assert.equal(options.strictMcpConfig, true, "no .mcp.json, user or plugin MCP servers");
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false", "no claude.ai connectors");
  assert.ok(toolkitTools.every((tool) => Context.get(tool.annotations, Tool.Readonly) && !Context.get(tool.annotations, Tool.Destructive)));
  assert.deepEqual(options.allowedTools, toolkitTools.map((tool) => toolName(tool.name)));

  assert.equal(options.permissionMode, "dontAsk", "anything not allowed is refused, never prompted for");
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  assert.equal(options.canUseTool, undefined, "nothing can approve a tool at run time");
});

test("the SDK loads none of the user's settings, hooks, skills, plugins or memory, and writes no transcript", () => {
  assert.deepEqual(options.settingSources, [], "no user, project or local settings, so no CLAUDE.md, hooks or permission rules");
  assert.deepEqual(options.settings, { disableAllHooks: true, autoMemoryEnabled: false });
  assert.deepEqual(options.skills, []);
  assert.deepEqual(options.plugins, []);
  assert.equal(options.persistSession, false);
  assert.equal(options.cwd, "/tmp/empty");
  for (const key of ["agents", "hooks", "additionalDirectories", "extraArgs", "resume", "continue", "sandbox"] as const) assert.equal(options[key], undefined, key);
});

test("the in-process MCP server lists the given tools and nothing else", async () => {
  const replies: unknown[] = [];
  const transport: SdkTransport = { send: async (message) => void replies.push(message), start: async () => {} };
  await sdkMcpServer(tools).connect(transport);
  transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  transport.onmessage?.({ jsonrpc: "2.0", id: 2, method: "resources/list" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const [list, other] = replies as [{ result: { tools: { name: string }[] } }, { error: { code: number } }];
  assert.deepEqual(list.result.tools.map((tool) => tool.name), toolkitTools.map((tool) => tool.name));
  assert.equal(other.error.code, -32601);
});
