import * as Schema from "effect/Schema";
import { SERVER_NAME } from "./runnerboxTools.ts";
import { AgentMessageDelta, ErrorNotification, ItemNotification, type Message, TurnCompleted } from "./codexProtocol.ts";
import type { ProviderEvent } from "./ProviderAdapter.ts";

// What a Codex turn does with each message from `codex app-server`, once the turn has started.
// Only Runnerbox's own tools, on the allow-list, go through. Everything Codex asks Runnerbox first
// (a command, a patch, a permission, a question for the user, a tool of the client's) is declined,
// so it never runs, and the turn ends. Anything else Codex starts, and anything this version doesn't
// know, ends the turn too: unknown never means allowed. The adapter kills the process on any end.

export type TurnState = { steps: number; readonly allowed: ReadonlySet<string>; readonly maxSteps: number };
export type Decision = {
  readonly events: ReadonlyArray<ProviderEvent>;
  // A reply to send before anything else, such as a refusal.
  readonly reply?: { readonly id: number | string; readonly result?: unknown; readonly error?: { readonly code: number; readonly message: string } };
  readonly end?: { readonly _tag: "Done" } | { readonly _tag: "Stopped"; readonly message: string };
};

const go = (events: ReadonlyArray<ProviderEvent> = []): Decision => ({ events });
const stop = (message: string, reply?: Decision["reply"]): Decision => ({ events: [], ...(reply ? { reply } : {}), end: { _tag: "Stopped", message } });

// Every request Codex 0.167.2 can send that would run something, with the answer that refuses it.
const REFUSALS: Record<string, { readonly what: string; readonly result: unknown }> = {
  "item/commandExecution/requestApproval": { what: "run a command", result: { decision: "decline" } },
  execCommandApproval: { what: "run a command", result: { decision: "denied" } },
  "item/fileChange/requestApproval": { what: "change files", result: { decision: "decline" } },
  applyPatchApproval: { what: "apply a patch", result: { decision: "denied" } },
  "item/permissions/requestApproval": { what: "widen its permissions", result: { permissions: {} } },
  "item/tool/requestUserInput": { what: "ask you a question", result: { answers: {} } },
  "mcpServer/elicitation/request": { what: "ask for input on behalf of an MCP server", result: { action: "decline" } },
  "item/tool/call": { what: "call a tool of the client's", result: { contentItems: [], success: false } },
};

// Notifications that say nothing about what the agent did beyond what items and text already say.
const QUIET = new Set([
  "remoteControl/status/changed",
  "thread/started",
  "thread/status/changed",
  "thread/settings/updated",
  "thread/tokenUsage/updated",
  "thread/name/updated",
  "thread/compacted",
  "turn/started",
  "turn/plan/updated",
  "turn/moderationMetadata",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "item/mcpToolCall/progress",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "account/rateLimits/updated",
  "serverRequest/resolved",
  "model/rerouted",
  "model/verification",
  "model/safetyBuffering/updated",
  "warning",
  "configWarning",
  "deprecationNotice",
]);

// Items a turn may start besides Runnerbox's tool calls: the prompt, text, reasoning and its own housekeeping.
const TEXT_ITEMS = new Set(["userMessage", "agentMessage", "reasoning", "plan", "contextCompaction"]);

const decodeItem = Schema.decodeUnknownOption(ItemNotification);
const decodeDelta = Schema.decodeUnknownOption(AgentMessageDelta);
const decodeCompleted = Schema.decodeUnknownOption(TurnCompleted);
const decodeError = Schema.decodeUnknownOption(ErrorNotification);
const UNREADABLE = (what: string) => stop(`Codex sent ${what} that Runnerbox couldn't read. The turn was stopped.`);

export function decide(message: Message, state: TurnState): Decision {
  if (!("method" in message)) return stop("Codex answered a request Runnerbox didn't make. The turn was stopped.");
  if ("id" in message) {
    const refusal = REFUSALS[message.method];
    if (refusal === undefined) return stop(`Codex asked \`${message.method}\`, which Runnerbox doesn't answer. The turn was stopped.`, { id: message.id, error: { code: -32601, message: "Runnerbox doesn't answer this." } });
    return stop(`Codex asked to ${refusal.what}, which Runnerbox doesn't allow. It was declined before it ran, and the turn stopped.`, { id: message.id, result: refusal.result });
  }
  const { method, params } = message;
  if (QUIET.has(method)) return go();
  switch (method) {
    case "item/agentMessage/delta": {
      const delta = decodeDelta(params);
      return delta._tag === "Some" ? go([{ _tag: "TextDelta", text: delta.value.delta }]) : UNREADABLE("a text delta");
    }
    case "item/started": {
      const started = decodeItem(params);
      if (started._tag === "None") return UNREADABLE("an item");
      const item = started.value.item;
      if (item.type === "mcpToolCall" && "tool" in item) {
        if (item.server !== SERVER_NAME || !state.allowed.has(item.tool)) return stop(`Codex called \`${item.server}.${item.tool}\`, which this turn isn't allowed. The turn was stopped.`);
        state.steps += 1;
        if (state.steps > state.maxSteps) return stop("The agent used all its steps without finishing.");
        return go([{ _tag: "ToolCall", name: item.tool, input: item.arguments }]);
      }
      return TEXT_ITEMS.has(item.type) ? go() : stop(`Codex started a \`${item.type}\` item, which Runnerbox doesn't allow. The turn was stopped.`);
    }
    case "item/completed": {
      const completed = decodeItem(params);
      if (completed._tag === "None") return UNREADABLE("an item");
      const item = completed.value.item;
      if (item.type === "agentMessage" && "text" in item) return go([{ _tag: "Text", text: item.text }]);
      // Anything else that finished was allowed when it started, or the turn already ended.
      return item.type === "mcpToolCall" || TEXT_ITEMS.has(item.type) ? go() : stop(`Codex finished a \`${item.type}\` item, which Runnerbox doesn't allow. The turn was stopped.`);
    }
    case "turn/completed": {
      const completed = decodeCompleted(params);
      if (completed._tag === "None") return UNREADABLE("the turn's end");
      const { status, error } = completed.value.turn;
      if (status === "completed") return { events: [{ _tag: "Done", costUsd: null }], end: { _tag: "Done" } };
      return stop(error?.message ?? (status === "interrupted" ? "Codex stopped the turn." : "Codex stopped with an error."));
    }
    case "error": {
      const error = decodeError(params);
      if (error._tag === "None") return UNREADABLE("an error");
      return error.value.willRetry ? go() : stop(error.value.error.message.slice(0, 300) || "Codex stopped with an error.");
    }
    default:
      return stop(`Codex sent \`${method}\`, which a Runnerbox turn doesn't allow or doesn't know. The turn was stopped.`);
  }
}
