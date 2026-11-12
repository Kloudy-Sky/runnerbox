import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { issueTicket, pairWithCode } from "@runnerbox/client-runtime";
import * as Effect from "effect/Effect";
import { mcpSession as mcpClient } from "../testing/mcpClient.ts";
import { startTestServer } from "../testing/testServer.ts";

let server: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const mcpSession = (token: string) => mcpClient(`${server.baseUrl}/mcp`, token);

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
  const inbox = called.result.structuredContent ?? JSON.parse(called.result.content[0].text);
  assert.match(inbox.summary.headline, /need/);
  assert.ok(inbox.items.some((item: { kind: string; verdict: string | null }) => item.kind === "failure" && item.verdict === "infra"));
});

test("/mcp takes only agent tokens, and an agent token can't open the app's socket", async () => {
  const { code } = await server.createPairingCode(["history:read", "runners:read"]);
  const app = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
  assert.equal((await mcpSession(app.token)).init.status, 401);
  assert.equal((await mcpSession("rbx_not-a-token")).init.status, 401);
  const refused = await Effect.runPromise(Effect.flip(issueTicket(server.baseUrl, await server.mintMcpToken())));
  assert.equal(refused.reason, "unauthorized");
});
