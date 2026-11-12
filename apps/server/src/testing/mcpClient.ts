// Speaks just enough Streamable HTTP MCP to list and call tools: initialize, then requests that
// carry the session it returns. Answers come as JSON or as one server-sent event.
export async function mcpSession(url: string, token: string) {
  let sessionId: string | null = null;
  let id = 0;
  const post = async (body: object) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
    sessionId ??= response.headers.get("mcp-session-id");
    const text = await response.text();
    const json = text.startsWith("{") ? text : (text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "null");
    return { status: response.status, body: JSON.parse(json) };
  };
  const request = (method: string, params: object = {}) => post({ jsonrpc: "2.0", id: ++id, method, params });
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  if (init.status === 200) await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { init, request };
}
