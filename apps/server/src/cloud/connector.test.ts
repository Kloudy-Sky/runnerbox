import assert from "node:assert/strict";
import { test } from "node:test";
import { atLeast, CLOUDFLARED_MIN_VERSION, connectorCommand, parseVersion } from "./connector.ts";

test("the connector gets its token from the environment, never on its command line", () => {
  const { args, env } = connectorCommand("secret-token");
  assert.deepEqual(args, ["tunnel", "--no-autoupdate", "run"]);
  assert.ok(!args.join(" ").includes("secret-token"));
  assert.deepEqual(env, { TUNNEL_TOKEN: "secret-token" });
});

test("a cloudflared older than the flags need is refused", () => {
  assert.deepEqual(parseVersion("cloudflared version 2026.10.4 (built 2026-10-20-1200 UTC)"), [2026, 10, 4]);
  assert.equal(atLeast([2026, 10, 4], CLOUDFLARED_MIN_VERSION), true);
  assert.equal(atLeast([2025, 6, 1], CLOUDFLARED_MIN_VERSION), true);
  assert.equal(atLeast([2025, 5, 9], CLOUDFLARED_MIN_VERSION), false);
  assert.equal(parseVersion("command not found"), null);
});
