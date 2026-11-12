import * as Schema from "effect/Schema";
import type { ProviderEvent } from "./ProviderAdapter.ts";
import { SERVER_NAME } from "./claudeCommand.ts";

// The few lines of `claude --output-format=stream-json` a turn needs, decoded rather than trusted: text as it streams, finished
// text and tool calls, and the result. Anything else, and anything from a subagent, is skipped.

const TopLevel = { parent_tool_use_id: Schema.Null };
const StreamDelta = Schema.Struct({
  type: Schema.Literal("stream_event"),
  ...TopLevel,
  event: Schema.Struct({ type: Schema.Literal("content_block_delta"), delta: Schema.Struct({ type: Schema.Literal("text_delta"), text: Schema.String }) }),
});
const Block = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool_use"), name: Schema.String, input: Schema.Unknown }),
  Schema.Struct({ type: Schema.String }),
]);
const Assistant = Schema.Struct({ type: Schema.Literal("assistant"), ...TopLevel, message: Schema.Struct({ content: Schema.Array(Block) }) });
const Result = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  is_error: Schema.Boolean,
  total_cost_usd: Schema.optionalKey(Schema.Number),
  result: Schema.optionalKey(Schema.String),
});
const Message = Schema.Union([StreamDelta, Assistant, Result]);
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Message));

const PREFIX = `mcp__${SERVER_NAME}__`;
const STOPPED: Record<string, string> = {
  error_max_turns: "The agent used all its steps without finishing.",
  error_during_execution: "Claude Code stopped with an error.",
};

export type Decoded = { readonly events: ReadonlyArray<ProviderEvent>; readonly error: string | null };

export function decodeLine(line: string): Decoded {
  const decoded = decode(line);
  if (decoded._tag === "None") return { events: [], error: null };
  const value = decoded.value;
  switch (value.type) {
    case "stream_event":
      return { events: [{ _tag: "TextDelta", text: value.event.delta.text }], error: null };
    case "assistant":
      return {
        events: value.message.content.flatMap((block): ProviderEvent[] =>
          "text" in block ? [{ _tag: "Text", text: block.text }] : "name" in block ? [{ _tag: "ToolCall", name: block.name.replace(PREFIX, ""), input: block.input }] : [],
        ),
        error: null,
      };
    case "result":
      return value.is_error || value.subtype !== "success"
        ? { events: [], error: STOPPED[value.subtype] ?? (value.result?.slice(0, 300) || "Claude Code stopped with an error.") }
        : { events: [{ _tag: "Done", costUsd: value.total_cost_usd ?? null }], error: null };
  }
}
