import { MAX_COMMAND_SECONDS } from "runnerbox/src/reproduce/protocol.ts";
import { RunnerboxToolkit } from "../../mcp/tools.ts";

// How a thread's turn runs the environment's own `claude`: headless, streaming JSON in and out,
// with runnerbox's `/mcp` endpoint as its only tools. Every flag that bounds what the agent can
// reach is here, so one test can read the whole command. The isolation follows T3 Code's
// ClaudeProvider (MIT, see THIRD_PARTY_NOTICES.md).

export const SERVER_NAME = "runnerbox";
export const toolName = (name: string) => `mcp__${SERVER_NAME}__${name}`;
export const READ_ONLY_TOOLS = Object.keys(RunnerboxToolkit.tools).map(toolName);
export const REPRODUCE_TOOL = toolName("repro_exec");
// A turn the owner asked may propose a change; it only records one for the owner to decide.
export const PROPOSE_TOOL = toolName("propose_change");
export const MAX_AGENT_STEPS = 12;
// Rerunning a step and narrowing it down takes more steps than reading.
export const MAX_REPRODUCE_STEPS = 30;

export function claudeArgs(turn: { readonly mcpConfigPath: string; readonly systemPrompt: string; readonly model: string | undefined; readonly reproduce: boolean; readonly propose: boolean }) {
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
    // tool; a monitor's turn only reads.
    `--allowedTools=${[...READ_ONLY_TOOLS, ...(turn.propose ? [PROPOSE_TOOL] : []), ...(turn.reproduce ? [REPRODUCE_TOOL] : [])].join(",")}`,
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
    `--max-turns=${turn.reproduce ? MAX_REPRODUCE_STEPS : MAX_AGENT_STEPS}`,
    ...(turn.model === undefined ? [] : [`--model=${turn.model}`]),
  ];
}

// What `claude` needs to find its login and reach the network, and nothing else from the
// server's environment: no API key, cloud-provider switch or unrelated secret. A turn bills the
// account it runs as: the subscription's login, or a key the owner added in Settings.
const PASSED = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LANGUAGE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  // Where Claude Code keeps its login, when moved from ~/.claude.
  "CLAUDE_CONFIG_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);

const TOOL_TIMEOUT_MS = (MAX_COMMAND_SECONDS + 60) * 1000;

// `apiKey` is the turn's account's own key, the only credential that reaches `claude` from runnerbox.
export function claudeEnv(from: Record<string, string | undefined>, apiKey: string | null = null) {
  const passed = Object.entries(from).filter((entry): entry is [string, string] => entry[1] !== undefined && (PASSED.has(entry[0]) || entry[0].startsWith("LC_")));
  return {
    ...Object.fromEntries(passed),
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
// off the command line, since it holds job and branch names.
export const promptLine = (prompt: string) =>
  `${JSON.stringify({ type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null, session_id: "" })}\n`;
