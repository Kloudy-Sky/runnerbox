#!/usr/bin/env node
// Stands in for `codex` in the Codex adapter's tests: `--version`, `login status`, and an
// `app-server` that plays one scenario over stdio. Runnerbox passes it no test settings, since its
// environment is allow-listed, so it reads them from `fake-codex.json` in the state directory above
// its CODEX_HOME, and writes what it saw to `fake-codex.log` there, one JSON line each.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const stateDir = (process.env.CODEX_HOME ?? "").split("/.server/")[0] ?? "";
const settings: { scenario: string; version: string } = JSON.parse(readFileSync(join(stateDir, "fake-codex.json"), "utf8"));
const log = (entry: Record<string, unknown>) => appendFileSync(join(stateDir, "fake-codex.log"), `${JSON.stringify(entry)}\n`);
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log(`codex-cli ${settings.version}`);
  process.exit(0);
}
if (args[0] === "login") process.exit(0);

const { scenario } = settings;
// Reads on for a moment after SIGTERM, so a test sees what Runnerbox answered last, and writes into
// its home on the way out, as Codex may, so a test sees the home removed only after it closed.
process.on("SIGTERM", () =>
  setTimeout(() => {
    const home = process.env.CODEX_HOME ?? stateDir;
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "state.json"), "{}");
    process.exit(0);
  }, 300),
);
const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
// A process of its own, to show that ending the turn ends everything Codex started.
const sleeper = spawn("sleep", ["60"], { stdio: "ignore" });
log({ pids: [process.pid, sleeper.pid], env: { token: process.env.RUNNERBOX_MCP_TOKEN, key: process.env.CODEX_API_KEY ?? null, home: process.env.CODEX_HOME } });

const item = (kind: "item/started" | "item/completed", payload: Record<string, unknown>) => send({ method: kind, params: { threadId: "t", turnId: "u", startedAtMs: 0, item: { id: "i", ...payload } } });
const play = () => {
  switch (scenario) {
    case "answer":
      item("item/started", { type: "mcpToolCall", server: "runnerbox", tool: "ci_overview", arguments: { days: 7 }, status: "inProgress" });
      item("item/completed", { type: "mcpToolCall", server: "runnerbox", tool: "ci_overview", arguments: { days: 7 }, status: "completed" });
      send({ method: "item/agentMessage/delta", params: { threadId: "t", turnId: "u", itemId: "m", delta: "The machine" } });
      item("item/completed", { type: "agentMessage", text: "The machine ran short of memory." });
      return send({ method: "turn/completed", params: { threadId: "t", turn: { id: "u", items: [], status: "completed" } } });
    case "patch":
      // Codex asks before it applies a patch, and applies it only if told to.
      return send({ id: 100, method: "applyPatchApproval", params: { conversationId: "t", callId: "c", fileChanges: {}, reason: null, grantRoot: null } });
    case "subagent":
      return item("item/started", { type: "collabAgentToolCall", tool: "spawnAgent", status: "inProgress", agentsStates: {}, receiverThreadIds: [], senderThreadId: "t" });
    case "unknown":
      return send({ method: "thread/somethingNew", params: {} });
  }
};

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  log({ received: message.method ?? `response:${message.id}`, ...(message.method === undefined ? { result: message.result } : {}) });
  if (message.id === 100 && message.result?.decision === "approved") log({ executed: "applyPatch" });
  if (message.method === "initialize") send({ id: message.id, result: { userAgent: "codex/0.167.2", codexHome: "", platformFamily: "unix", platformOs: "macos" } });
  if (message.method === "thread/start") {
    const wide = scenario === "wide-sandbox";
    send({
      id: message.id,
      result: {
        thread: { id: "t" },
        approvalPolicy: message.params.approvalPolicy,
        approvalsReviewer: message.params.approvalsReviewer,
        sandbox: wide ? { type: "dangerFullAccess" } : { type: "readOnly", networkAccess: false },
        instructionSources: [],
        cwd: message.params.cwd,
        model: "example",
        modelProvider: "openai",
      },
    });
  }
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "u", items: [], status: "inProgress" } } });
    play();
  }
}
