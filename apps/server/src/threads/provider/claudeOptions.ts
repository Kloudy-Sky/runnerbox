import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTools } from "../AgentTools.ts";
import { SERVER_NAME, sdkMcpServer } from "./sdkMcpServer.ts";

// Adapted from T3 Code's ClaudeProvider (MIT, see THIRD_PARTY_NOTICES.md): its isolation options
// for a Claude Code process that shouldn't pick up the user's own setup.

export const toolName = (name: string) => `mcp__${SERVER_NAME}__${name}`;
export const MAX_AGENT_STEPS = 12;

export type ClaudeTurn = {
  readonly executable: string;
  // An empty directory, so no project files, CLAUDE.md or .mcp.json are near.
  readonly cwd: string;
  readonly model: string | undefined;
  readonly systemPrompt: string;
  readonly tools: AgentTools;
  readonly abortController: AbortController;
  readonly env: Record<string, string | undefined>;
};

// Everything that bounds what the agent can reach is here, so one test can read it.
export function claudeOptions(turn: ClaudeTurn): Options {
  const allowed = turn.tools.definitions.map((tool) => toolName(tool.name));
  return {
    pathToClaudeCodeExecutable: turn.executable,
    cwd: turn.cwd,
    ...(turn.model === undefined ? {} : { model: turn.model }),
    abortController: turn.abortController,
    // Replaces Claude Code's own prompt, which describes tools this agent doesn't have.
    systemPrompt: turn.systemPrompt,
    // No built-in tools at all: no shell, files, web, subagents or skills.
    tools: [],
    // The only MCP server is runnerbox's, in process. Strict mode ignores .mcp.json, user and
    // plugin servers.
    mcpServers: { [SERVER_NAME]: { type: "sdk", name: SERVER_NAME, instance: sdkMcpServer(turn.tools) } },
    strictMcpConfig: true,
    // Its tools run without asking, and anything else is refused rather than prompted for. No
    // `canUseTool`: allowed tools never reach it, and nothing else exists to ask about.
    allowedTools: allowed,
    permissionMode: "dontAsk",
    // No user, project or local settings, so no hooks, permission rules, plugins or CLAUDE.md.
    settingSources: [],
    settings: { disableAllHooks: true, autoMemoryEnabled: false },
    skills: [],
    plugins: [],
    // The thread's log is the record; nothing is written to ~/.claude/projects.
    persistSession: false,
    includePartialMessages: true,
    maxTurns: MAX_AGENT_STEPS,
    env: {
      ...turn.env,
      // claude.ai connectors are found outside the MCP config, so strict mode doesn't cover them.
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
      CLAUDE_AGENT_SDK_CLIENT_APP: "runnerbox",
    },
    stderr: () => {},
  };
}
