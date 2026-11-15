import { MAX_AGENT_STEPS, MAX_REPRODUCE_STEPS, PROPOSE_TOOL_NAME, READ_ONLY_TOOL_NAMES, REPRODUCE_TOOL_NAME, SERVER_NAME } from "./runnerboxTools.ts";
import type { ThreadStarted } from "./codexProtocol.ts";
import type { TurnImage } from "./ProviderAdapter.ts";

// How a thread's turn runs the environment's own `codex`: one `codex app-server` per turn, spoken
// to over stdio, so every tool call shows as an item before it finishes and every command, patch,
// question or permission it would need is asked of Runnerbox first, which declines. Codex has no
// allow-list for its built-in tools, so what holds it to Runnerbox's is that, Codex's read-only
// sandbox, and the features turned off below; codexTurnPolicy.ts ends the turn on anything else.
// Every setting that bounds what the agent can reach is here, so one test can read them all.

// The environment variable the turn's `/mcp` token travels in. It's in `codex`'s environment only,
// never on its command line, and shells it might start inherit nothing.
export const TOKEN_ENV = "RUNNERBOX_MCP_TOKEN";

// Built-in features that add tools or reach past Runnerbox's: a shell, code mode, subagents, apps,
// plugins, hooks, a browser, computer use, images, goals, sleep, tool suggestions, MCP prompts.
export const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  "multi_agent",
  "apps",
  "plugins",
  "hooks",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "image_generation",
  "view_image",
  "goals",
  "sleep_tool",
  "tool_suggest",
  "skill_search",
  "skill_mcp_dependency_install",
  "tool_call_mcp_elicitation",
  "shell_snapshot",
  "memories",
] as const;

// The tools a turn may call, by Codex's bare name on Runnerbox's server: the read-only ones, plus
// `propose_change` on an owner's turn and `repro_exec` inside a reproduce the owner started.
export const allowedTools = (turn: { readonly propose: boolean; readonly reproduce: boolean }) => [
  ...READ_ONLY_TOOL_NAMES,
  ...(turn.propose ? [PROPOSE_TOOL_NAME] : []),
  ...(turn.reproduce ? [REPRODUCE_TOOL_NAME] : []),
];
export const maxSteps = (turn: { readonly reproduce: boolean }) => (turn.reproduce ? MAX_REPRODUCE_STEPS : MAX_AGENT_STEPS);

const toml = (value: string) => JSON.stringify(value);

// `codex app-server` with every setting given here, after `--ignore-user-config`'s equivalent: the
// home is Runnerbox's own and holds no config.toml.
export function appServerArgs(turn: { readonly mcpUrl: string; readonly propose: boolean; readonly reproduce: boolean }) {
  return [
    "app-server",
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...[
      `web_search=${toml("disabled")}`,
      // No AGENTS.md, skills text or memory reaches the model.
      "project_doc_max_bytes=0",
      "skills.include_instructions=false",
      // Anything Codex itself runs gets no inherited environment, so not the turn's token.
      `shell_environment_policy.inherit=${toml("none")}`,
      // The only MCP server: Runnerbox's loopback `/mcp`, its tools by allow-list, and the turn
      // fails rather than running without it.
      `mcp_servers.${SERVER_NAME}.url=${toml(turn.mcpUrl)}`,
      `mcp_servers.${SERVER_NAME}.bearer_token_env_var=${toml(TOKEN_ENV)}`,
      `mcp_servers.${SERVER_NAME}.enabled_tools=[${allowedTools(turn).map(toml).join(",")}]`,
      `mcp_servers.${SERVER_NAME}.required=true`,
    ].flatMap((setting) => ["-c", setting]),
  ];
}

// `thread/start`: read-only sandbox, every approval asked of Runnerbox (which declines), nothing
// saved, Runnerbox's own instructions in place of Codex's, and an empty working directory.
export const threadStartParams = (turn: { readonly cwd: string; readonly systemPrompt: string; readonly model: string | undefined }) => ({
  cwd: turn.cwd,
  sandbox: "read-only",
  approvalPolicy: "untrusted",
  approvalsReviewer: "user",
  ephemeral: true,
  baseInstructions: turn.systemPrompt,
  ...(turn.model === undefined ? {} : { model: turn.model }),
});

// `turn/start`: the prompt as text, and images as data URLs in the same message, never a path.
export const turnStartParams = (threadId: string, prompt: string, images: ReadonlyArray<TurnImage>) => ({
  threadId,
  input: [...images.map((image) => ({ type: "image", url: `data:${image.mimeType};base64,${image.base64}` })), { type: "text", text: prompt, text_elements: [] }],
});

// The settings without which a declined approval would no longer prove a call didn't run, or Codex
// would reach past Runnerbox's tools. Written out here on their own, not taken from appServerArgs
// or DISABLED_FEATURES, so deleting one there fails this check instead of passing it: removing one
// means editing this list too, on purpose. Runnerbox checks every one before it starts `codex`.
const REQUIRED_PARAMS = { sandbox: "read-only", approvalPolicy: "untrusted", approvalsReviewer: "user", ephemeral: true } as const;
const REQUIRED_FEATURES_OFF = [
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  "multi_agent",
  "apps",
  "plugins",
  "hooks",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "image_generation",
  "view_image",
  "goals",
  "sleep_tool",
  "tool_suggest",
  "skill_search",
  "skill_mcp_dependency_install",
  "tool_call_mcp_elicitation",
  "shell_snapshot",
  "memories",
];
const requiredSettings = (turn: { readonly mcpUrl: string; readonly propose: boolean; readonly reproduce: boolean }) => [
  ...REQUIRED_FEATURES_OFF.map((feature) => `--disable ${feature}`),
  'web_search="disabled"',
  "project_doc_max_bytes=0",
  "skills.include_instructions=false",
  'shell_environment_policy.inherit="none"',
  `mcp_servers.runnerbox.url=${JSON.stringify(turn.mcpUrl)}`,
  'mcp_servers.runnerbox.bearer_token_env_var="RUNNERBOX_MCP_TOKEN"',
  `mcp_servers.runnerbox.enabled_tools=[${allowedTools(turn).map((tool) => JSON.stringify(tool)).join(",")}]`,
  "mcp_servers.runnerbox.required=true",
];
export function launchProblems(
  turn: { readonly mcpUrl: string; readonly propose: boolean; readonly reproduce: boolean },
  args: ReadonlyArray<string>,
  params: Readonly<Record<string, unknown>>,
) {
  const pairs = new Set(args.flatMap((arg, index) => (index > 0 ? [`${args[index - 1] === "--disable" ? "--disable " : ""}${arg}`] : [])));
  const missingArgs = requiredSettings(turn).filter((setting) => !pairs.has(setting));
  const wrongParams = Object.entries(REQUIRED_PARAMS).flatMap(([key, value]) => (params[key] === value ? [] : [`${key}=${String(value)}`]));
  return [...missingArgs, ...wrongParams];
}

// What `thread/start` says Codex applied, checked before the prompt is sent: a config or managed
// policy Runnerbox didn't write could otherwise change it.
export function appliedProblems(applied: Omit<ThreadStarted, "thread">) {
  const { sandbox } = applied;
  return [
    ...(applied.approvalPolicy === REQUIRED_PARAMS.approvalPolicy ? [] : ["approvals aren't all asked of Runnerbox"]),
    ...(applied.approvalsReviewer === REQUIRED_PARAMS.approvalsReviewer ? [] : ["approvals go to a reviewer other than Runnerbox"]),
    ...(sandbox.type === "readOnly" && sandbox.networkAccess !== true ? [] : ["the sandbox isn't read-only without network"]),
    ...((applied.instructionSources ?? []).length === 0 ? [] : ["it loaded instruction files"]),
  ];
}

// The Codex releases this adapter was written and checked against. A newer one can add an item kind
// or request that runs without asking, so it isn't run until Runnerbox is checked against it too.
export const SUPPORTED_CODEX = { major: 0, minor: 167, fromPatch: 2 } as const;
export const SUPPORTED_CODEX_LABEL = `${SUPPORTED_CODEX.major}.${SUPPORTED_CODEX.minor}.${SUPPORTED_CODEX.fromPatch} or a later ${SUPPORTED_CODEX.major}.${SUPPORTED_CODEX.minor} release`;
export function supportedVersion(versionOutput: string) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(versionOutput);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major === SUPPORTED_CODEX.major && minor === SUPPORTED_CODEX.minor && patch! >= SUPPORTED_CODEX.fromPatch;
}
