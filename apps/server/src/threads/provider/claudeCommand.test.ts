import assert from "node:assert/strict";
import { test } from "node:test";
import * as Context from "effect/Context";
import { Tool } from "effect/ai";
import { RunnerboxToolkit } from "../../mcp/tools.ts";
import { claudeArgs, claudeEnv, MAX_AGENT_STEPS, mcpConfig, promptLine, READ_ONLY_TOOLS } from "./claudeCommand.ts";

// What a thread's agent can reach is decided entirely by the command that starts `claude`. Each
// assertion is a boundary the threat model names.

const args = claudeArgs({ mcpConfigPath: "/state/.server/agent/mcp/turn.json", systemPrompt: "prompt", model: undefined });

test("claude runs with no built-in tools, only runnerbox's read-only MCP tools, and none of the user's setup", () => {
  const toolkit = Object.values(RunnerboxToolkit.tools);
  assert.ok(toolkit.every((tool) => Context.get(tool.annotations, Tool.Readonly) && !Context.get(tool.annotations, Tool.Destructive)));
  assert.deepEqual(args, [
    "--print",
    "--input-format=stream-json",
    "--output-format=stream-json",
    "--verbose",
    "--include-partial-messages",
    // No shell, file, web, subagent or skill tools.
    "--tools=",
    // Only runnerbox's MCP server, from the turn's file; no .mcp.json, user or plugin servers.
    "--mcp-config",
    "/state/.server/agent/mcp/turn.json",
    "--strict-mcp-config",
    // Exactly the read-only tools run; anything else is refused without a prompt.
    `--allowedTools=${toolkit.map((tool) => `mcp__runnerbox__${tool.name}`).join(",")}`,
    "--permission-mode=dontAsk",
    "--permission-prompts=none",
    // No settings files, so no CLAUDE.md, hooks, permission rules or plugins; no memory or connectors.
    "--setting-sources=",
    '--settings={"disableAllHooks":true,"autoMemoryEnabled":false,"disableClaudeAiConnectors":true}',
    "--disable-slash-commands",
    "--no-session-persistence",
    "--system-prompt=prompt",
    `--max-turns=${MAX_AGENT_STEPS}`,
  ]);
  assert.equal(READ_ONLY_TOOLS.length, toolkit.length);
  assert.deepEqual(claudeArgs({ mcpConfigPath: "x", systemPrompt: "p", model: "haiku" }).at(-1), "--model=haiku");
});

test("claude gets an allow-listed environment, so no API key, provider switch or other secret reaches it", () => {
  const server = {
    PATH: "/usr/bin",
    HOME: "/home/example",
    USER: "example",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TMPDIR: "/tmp",
    XDG_CONFIG_HOME: "/home/example/.config",
    CLAUDE_CONFIG_DIR: "/home/example/.claude",
    HTTPS_PROXY: "http://proxy.example:3128",
    ANTHROPIC_API_KEY: "sk-ant-example",
    ANTHROPIC_BASE_URL: "https://gateway.example",
    CLAUDE_CODE_USE_BEDROCK: "1",
    AWS_SECRET_ACCESS_KEY: "example",
    GITHUB_TOKEN: "example",
    RUNNERBOX_CLAUDE_MODEL: "haiku",
    UNSET: undefined,
  };
  assert.deepEqual(claudeEnv(server), {
    PATH: "/usr/bin",
    HOME: "/home/example",
    USER: "example",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TMPDIR: "/tmp",
    XDG_CONFIG_HOME: "/home/example/.config",
    CLAUDE_CONFIG_DIR: "/home/example/.claude",
    HTTPS_PROXY: "http://proxy.example:3128",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    ENABLE_MCP_LARGE_OUTPUT_FILES: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
  });
});

test("the turn's MCP config names one HTTP server, and the prompt goes on stdin", () => {
  assert.deepEqual(JSON.parse(mcpConfig("http://127.0.0.1:4517/mcp", "rbx_turn")), {
    mcpServers: { runnerbox: { type: "http", url: "http://127.0.0.1:4517/mcp", headers: { Authorization: "Bearer rbx_turn" } } },
  });
  assert.ok(!args.some((arg) => arg.includes("rbx_")), "the token stays off the command line");
  assert.deepEqual(JSON.parse(promptLine("Why?")).message, { role: "user", content: "Why?" });
});
