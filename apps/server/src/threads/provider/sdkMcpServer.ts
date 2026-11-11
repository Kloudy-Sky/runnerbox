import type { AgentTools } from "../AgentTools.ts";

// The SDK hands an in-process MCP server a transport and asks only that it `connect`. This answers
// the few requests Claude Code makes of a tools-only server, so threads need neither the MCP SDK
// nor zod.

type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export type SdkTransport = {
  onmessage?: (message: JsonRpcMessage) => void;
  send: (message: object) => Promise<void>;
  start: () => Promise<void>;
};

export const SERVER_NAME = "runnerbox";

export function sdkMcpServer(tools: AgentTools) {
  const answer = async (request: JsonRpcMessage) => {
    const params = request.params ?? {};
    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: "1" },
        };
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: tools.definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false } })),
        };
      case "tools/call": {
        const result = await tools.call(String(params.name), params.arguments);
        return { content: [{ type: "text", text: result.text }], isError: result.isError };
      }
      default:
        return undefined;
    }
  };
  return {
    connect: async (transport: SdkTransport) => {
      transport.onmessage = (message) => {
        // Notifications carry no id and get no reply.
        if (message.id === undefined || message.id === null || message.method === undefined) return;
        const id = message.id;
        void answer(message).then(
          (result) =>
            transport.send(
              result === undefined
                ? { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } }
                : { jsonrpc: "2.0", id, result },
            ),
          (error: unknown) => transport.send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(error) } }),
        );
      };
      await transport.start();
    },
  };
}
