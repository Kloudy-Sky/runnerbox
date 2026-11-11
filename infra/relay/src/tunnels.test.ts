import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudflareTunnels, RateLimited } from "./tunnels.ts";

test("provisioning routes only the hostname, only to the loopback origin, and records the tunnel before DNS", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname.replace("/client/v4", "");
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const result = path.endsWith("/token") ? "connector-token" : { id: path.includes("dns_records") ? "dns-1" : "tunnel-1" };
    return Response.json({ success: true, result });
  };
  const provider = cloudflareTunnels({ accountId: "account", zoneId: "zone", apiToken: "token", fetch: fakeFetch });
  const recorded: string[] = [];
  const result = await provider.provision({
    name: "rbx-0123456789abcdef",
    hostname: "rbx-0123456789abcdef.connect.example.com",
    origin: { host: "127.0.0.1", port: 4517 },
    existing: { tunnelId: null, dnsRecordId: null },
    onTunnel: async (id) => void recorded.push(`${id} after ${calls.length} calls`),
  });
  assert.deepEqual(result, { tunnelId: "tunnel-1", dnsRecordId: "dns-1", connectorToken: "connector-token" });
  assert.deepEqual(recorded, ["tunnel-1 after 1 calls"]);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    "POST /accounts/account/cfd_tunnel",
    "PUT /accounts/account/cfd_tunnel/tunnel-1/configurations",
    "POST /zones/zone/dns_records",
    "GET /accounts/account/cfd_tunnel/tunnel-1/token",
  ]);
  assert.deepEqual(calls[1]?.body, {
    config: { ingress: [{ hostname: "rbx-0123456789abcdef.connect.example.com", service: "http://127.0.0.1:4517" }, { service: "http_status:404" }] },
  });
});

test("a replacement tunnel repoints the hostname's existing record, and a 429 is reported as a rate limit", async () => {
  const calls: string[] = [];
  let limited = false;
  const fakeFetch: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname.replace("/client/v4", "");
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (limited) return Response.json({ success: false }, { status: 429 });
    return Response.json({ success: true, result: path.endsWith("/token") ? "token-2" : { id: "tunnel-2" } });
  };
  const provider = cloudflareTunnels({ accountId: "account", zoneId: "zone", apiToken: "token", fetch: fakeFetch });
  await provider.provision({ name: "rbx-0123456789abcdef", hostname: "rbx-0123456789abcdef.example.com", origin: { host: "127.0.0.1", port: 4518 }, existing: { tunnelId: null, dnsRecordId: "dns-1" }, onTunnel: async () => {} });
  assert.ok(calls.includes("PATCH /zones/zone/dns_records/dns-1"));
  assert.ok(!calls.includes("POST /zones/zone/dns_records"));
  limited = true;
  await assert.rejects(provider.list({ status: "down", namePrefix: "rbx-", page: 1, perPage: 100 }), RateLimited);
});
