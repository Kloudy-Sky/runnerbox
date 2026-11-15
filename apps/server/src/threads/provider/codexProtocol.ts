import * as Schema from "effect/Schema";

// The few `codex app-server` messages a turn reads, decoded rather than trusted, from the schema
// Codex 0.167.2 generates (`codex app-server generate-json-schema`). One JSON object per line, with
// no `jsonrpc` field. A line that decodes as none of these ends the turn.

const Id = Schema.Union([Schema.Number, Schema.String]);

export const Response = Schema.Struct({ id: Id, result: Schema.Unknown });
export const ErrorResponse = Schema.Struct({ id: Id, error: Schema.Struct({ message: Schema.String }) });
// Codex asking Runnerbox something: an approval, a question for the user, a tool of the client's.
export const ServerRequest = Schema.Struct({ id: Id, method: Schema.String, params: Schema.optionalKey(Schema.Unknown) });
export const Notification = Schema.Struct({ method: Schema.String, params: Schema.optionalKey(Schema.Unknown) });
// Order matters: a request also has an `id`, and every message but a response has a `method`.
export const Message = Schema.Union([ErrorResponse, ServerRequest, Response, Notification]);
export type Message = typeof Message.Type;
export const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Message));

// What `thread/start` says it applied. Runnerbox checks these before it sends the prompt.
export const ThreadStarted = Schema.Struct({
  thread: Schema.Struct({ id: Schema.String }),
  approvalPolicy: Schema.Unknown,
  approvalsReviewer: Schema.Unknown,
  sandbox: Schema.Struct({ type: Schema.String, networkAccess: Schema.optionalKey(Schema.Unknown) }),
  instructionSources: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type ThreadStarted = typeof ThreadStarted.Type;

// An item as `item/started` and `item/completed` carry it. Only the kinds a turn may produce are
// read beyond their `type`.
export const McpToolCall = Schema.Struct({ type: Schema.Literal("mcpToolCall"), server: Schema.String, tool: Schema.String, arguments: Schema.Unknown });
export const AgentMessage = Schema.Struct({ type: Schema.Literal("agentMessage"), text: Schema.String });
export const OtherItem = Schema.Struct({ type: Schema.String });
export const Item = Schema.Union([McpToolCall, AgentMessage, OtherItem]);
export const ItemNotification = Schema.Struct({ item: Item });

export const AgentMessageDelta = Schema.Struct({ delta: Schema.String });
export const TurnCompleted = Schema.Struct({
  turn: Schema.Struct({ status: Schema.String, error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.String }))) }),
});
export const ErrorNotification = Schema.Struct({ error: Schema.Struct({ message: Schema.String }), willRetry: Schema.Boolean });

// What `mcpServerStatus/list` says of the thread's MCP servers, checked before the prompt is sent.
export const McpServers = Schema.Struct({
  data: Schema.Array(Schema.Struct({ name: Schema.String, runtimeStatus: Schema.optionalKey(Schema.NullOr(Schema.String)), tools: Schema.Record(Schema.String, Schema.Unknown) })),
  nextCursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type McpServers = typeof McpServers.Type;
