import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { issueTicket, pairWithCode } from "@runnerbox/client-runtime";
import * as Effect from "effect/Effect";
import { startTestServer } from "../testing/testServer.ts";

let server: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

// Speaks just enough Streamable HTTP MCP to list and call tools: initialize, then requests that
// carry the session it returns. Answers come as JSON or as one server-sent event.
async function mcpSession(token: string) {
  let sessionId: string | null = null;
  let id = 0;
  const post = async (body: object) => {
    const response = await fetch(`${server.baseUrl}/mcp`, {
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

test("an agent's token lists only read-only tools and reads the same inbox the app does", async () => {
  const { init, request } = await mcpSession(await server.mintMcpToken());
  assert.equal(init.status, 200);
  const { body: listed } = await request("tools/list");
  const tools: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[] = listed.result.tools;
  assert.ok(tools.length >= 10);
  assert.deepEqual(
    tools.filter((tool) => tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false).map((tool) => tool.name),
    [],
  );
  const { body: called } = await request("tools/call", { name: "ci_inbox", arguments: { days: 7 } });
  const items = called.result.structuredContent ?? JSON.parse(called.result.content[0].text);
  const list = Array.isArray(items) ? items : items.result;
  assert.ok(list.some((item: { kind: string; verdict: string | null }) => item.kind === "failure" && item.verdict === "infra"));
});

test("/mcp takes only agent tokens, and an agent token can't open the app's socket", async () => {
  const { code } = await server.createPairingCode(["history:read", "runners:read"]);
  const app = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
  assert.equal((await mcpSession(app.token)).init.status, 401);
  assert.equal((await mcpSession("rbx_not-a-token")).init.status, 401);
  const refused = await Effect.runPromise(Effect.flip(issueTicket(server.baseUrl, await server.mintMcpToken())));
  assert.equal(refused.reason, "unauthorized");
});
