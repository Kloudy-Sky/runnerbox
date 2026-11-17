import { MAX_COMMAND_SECONDS } from "runnerbox/src/reproduce/protocol.ts";
import { passedEnv } from "./agentEnv.ts";
import type { TurnImage } from "./ProviderAdapter.ts";
import { MAX_AGENT_STEPS, MAX_REPRODUCE_STEPS, MAX_REVIEW_STEPS, PROPOSE_TOOL_NAME, READ_ONLY_TOOL_NAMES, REPRODUCE_TOOL_NAME, REVIEW_TOOL_NAMES, SERVER_NAME } from "./runnerboxTools.ts";

// How a thread's turn runs the environment's own `claude`: headless, streaming JSON in and out,
// with runnerbox's `/mcp` endpoint as its only tools. Every flag that bounds what the agent can
// reach is here, so one test can read the whole command. The isolation follows T3 Code's
// ClaudeProvider (MIT, see THIRD_PARTY_NOTICES.md).

export { MAX_AGENT_STEPS, MAX_REPRODUCE_STEPS, SERVER_NAME };
export const toolName = (name: string) => `mcp__${SERVER_NAME}__${name}`;
export const READ_ONLY_TOOLS = READ_ONLY_TOOL_NAMES.map(toolName);
export const REPRODUCE_TOOL = toolName(REPRODUCE_TOOL_NAME);
export const PROPOSE_TOOL = toolName(PROPOSE_TOOL_NAME);
export const REVIEW_TOOLS = REVIEW_TOOL_NAMES.map(toolName);

export function claudeArgs(turn: { readonly mcpConfigPath: string; readonly systemPrompt: string; readonly model: string | undefined; readonly effort?: string | null; readonly reproduce: boolean; readonly propose: boolean; readonly review?: boolean }) {
  return [
    "--print",
    "--input-format=stream-json",
    "--output-format=stream-json",
    // The CLI only streams JSON from --print with --verbose.
    "--verbose",
    "--include-partial-messages",
    // No built-in tools at all: no shell, files, web, subagents or skills.
    "--tools=",
    // The only MCP server is runnerbox's own `/mcp`, from a file holding the turn's token.
    // Strict mode ignores .mcp.json, user and plugin servers.
    "--mcp-config",
    turn.mcpConfigPath,
    "--strict-mcp-config",
    // Its tools run without asking. Anything else is refused, and nothing ever prompts. A turn the
    // owner asked may also record a proposed change, and with a reproduce running, use its shell
    // tool; a monitor's turn only reads. A review's turn reads untrusted code, so it gets the
    // review's own tools and none that read this machine's CI history.
    `--allowedTools=${(turn.review ? REVIEW_TOOLS : [...READ_ONLY_TOOLS, ...(turn.propose ? [PROPOSE_TOOL] : []), ...(turn.reproduce ? [REPRODUCE_TOOL] : [])]).join(",")}`,
    "--permission-mode=dontAsk",
    "--permission-prompts=none",
    // No user, project or local settings, so no hooks, permission rules, plugins or CLAUDE.md.
    "--setting-sources=",
    `--settings=${JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false, disableClaudeAiConnectors: true })}`,
    "--disable-slash-commands",
    // The thread's log is the record; nothing is written to ~/.claude/projects.
    "--no-session-persistence",
    // Replaces Claude Code's own prompt, which describes tools this agent doesn't have.
    `--system-prompt=${turn.systemPrompt}`,
    `--max-turns=${turn.review ? MAX_REVIEW_STEPS : turn.reproduce ? MAX_REPRODUCE_STEPS : MAX_AGENT_STEPS}`,
    ...(turn.review ? ["--effort=high"] : turn.effort ? [`--effort=${turn.effort}`] : []),
    ...(turn.model === undefined ? [] : [`--model=${turn.model}`]),
  ];
}

// Where Claude Code keeps its login, when moved from ~/.claude: the one name `claude` needs beyond
// what every agent gets. A turn bills the account it runs as: the subscription's login, or a key the
// owner added in Settings.
const CLAUDE_PASSED = new Set(["CLAUDE_CONFIG_DIR"]);

const TOOL_TIMEOUT_MS = (MAX_COMMAND_SECONDS + 60) * 1000;

// `apiKey` is the turn's account's own key, the only credential that reaches `claude` from runnerbox.
export function claudeEnv(from: Record<string, string | undefined>, apiKey: string | null = null) {
  return {
    ...passedEnv(from, CLAUDE_PASSED),
    ...(apiKey === null ? {} : { ANTHROPIC_API_KEY: apiKey }),
    // claude.ai connectors are found outside the MCP config, so strict mode doesn't cover them.
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    // A tool result too big for the context is cut, not saved under ~/.claude/projects, which
    // --no-session-persistence doesn't cover. The agent has no tool to read such a file anyway.
    ENABLE_MCP_LARGE_OUTPUT_FILES: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
    // A reproduce command can take up to 10 minutes; Claude Code's own MCP timeout is shorter.
    MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS),
  };
}

// The `--mcp-config` file: one HTTP server, runnerbox's loopback `/mcp`, with a token minted for
// this turn. A file rather than an argument, so the token never shows in the process list.
export const mcpConfig = (url: string, token: string) =>
  JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } });

// One user message on stdin, in the shape `--input-format=stream-json` reads. The prompt stays
// off the command line, since it holds job and branch names, and images go as base64 blocks in the
// same message, never as a path the agent could open.
export const promptLine = (prompt: string, images: ReadonlyArray<TurnImage> = []) => {
  const content =
    images.length === 0
      ? prompt
      : [...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } })), { type: "text", text: prompt }];
  return `${JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" })}\n`;
};
