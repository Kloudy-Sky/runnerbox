import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { clerkEndpoints, deviceAuthorize, loopbackAuthorize } from "./oauth.ts";

// A stand-in for Clerk's OAuth endpoints: it checks PKCE as Clerk would, and approves a device
// code on the third poll.
async function fakeClerk() {
  const challenges = new Map<string, string>();
  let polls = 0;
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const form = new URLSearchParams(text);
    const reply = (status: number, body: object) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.url === "/oauth/device_authorization") return reply(200, { device_code: "device-1", user_code: "ABCD-EFGH", verification_uri: "https://clerk.example.com/device", interval: 1, expires_in: 60 });
    if (form.get("grant_type") === "authorization_code") {
      const expected = challenges.get(form.get("code") ?? "");
      const actual = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      return expected === actual ? reply(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 60 }) : reply(400, { error: "invalid_grant" });
    }
    if (form.get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code") return ++polls < 3 ? reply(400, { error: "authorization_pending" }) : reply(200, { access_token: "access-device" });
    reply(400, { error: "unsupported" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { endpoints: clerkEndpoints(`http://127.0.0.1:${(server.address() as AddressInfo).port}`), challenges, close: () => server.close() };
}

// Plays the browser: reads the authorize URL, "signs in", and follows the redirect back.
const browser = (clerk: Awaited<ReturnType<typeof fakeClerk>>, tamper?: (redirect: URL) => void) => (authorize: string) => {
  const url = new URL(authorize);
  clerk.challenges.set("code-1", url.searchParams.get("code_challenge")!);
  const redirect = new URL(url.searchParams.get("redirect_uri")!);
  redirect.searchParams.set("code", "code-1");
  redirect.searchParams.set("state", url.searchParams.get("state")!);
  tamper?.(redirect);
  assert.equal(redirect.hostname, "127.0.0.1", "the redirect only ever reaches this machine");
  void fetch(redirect);
};

test("loopback sign-in exchanges the code with its PKCE verifier, and refuses a redirect from another attempt", async () => {
  const clerk = await fakeClerk();
  try {
    const tokens = await loopbackAuthorize({ endpoints: clerk.endpoints, clientId: "cli", openBrowser: browser(clerk) });
    assert.equal(tokens.accessToken, "access-1");
    await assert.rejects(
      loopbackAuthorize({ endpoints: clerk.endpoints, clientId: "cli", openBrowser: browser(clerk, (redirect) => redirect.searchParams.set("state", "someone-else")) }),
      /didn't match/,
    );
  } finally {
    clerk.close();
  }
});

test("the device grant shows the code, waits while it's pending, and returns the token once approved", async () => {
  const clerk = await fakeClerk();
  try {
    const shown: string[] = [];
    const tokens = await deviceAuthorize({ endpoints: clerk.endpoints, clientId: "cli", onCode: ({ userCode }) => shown.push(userCode), sleep: async () => {} });
    assert.deepEqual(shown, ["ABCD-EFGH"]);
    assert.equal(tokens.accessToken, "access-device");
  } finally {
    clerk.close();
  }
});
