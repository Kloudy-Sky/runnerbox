import assert from "node:assert/strict";
import { test } from "node:test";
import { readSavedEnvironments } from "./environments.ts";

test("environments saved with one route keep working after routes became a list", () => {
  const legacy = { environmentId: "env-1", label: "example", route: { kind: "direct", url: "http://127.0.0.1:4517" }, token: "rbx_x", scopes: ["history:read"], pairedAt: "2026-01-01T00:00:00.000Z" };
  const current = { ...legacy, environmentId: "env-2", route: undefined, routes: [{ kind: "connect", relayUrl: "https://relay.example.com" }], token: null };
  assert.deepEqual(
    readSavedEnvironments([legacy, current, { garbage: true }]).map((saved) => [saved.environmentId, saved.routes.map((route) => route.kind)]),
    [
      ["env-1", ["direct"]],
      ["env-2", ["connect"]],
    ],
  );
});
