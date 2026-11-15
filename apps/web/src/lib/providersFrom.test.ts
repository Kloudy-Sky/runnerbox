import assert from "node:assert/strict";
import { test } from "node:test";
import type { Account } from "@runnerbox/contracts";
import { providersFrom } from "./providersFrom.ts";

const ready = { provider: "Claude", available: true, fix: null };
const account = (id: string): Account => ({ id, driver: "claude", label: id, model: null, billing: "subscription", keyLast4: null, isDefault: id === "a", builtIn: id === "a", status: ready });

test("an older server's harnesses and accounts read as one provider each, with its own accounts", () => {
  const providers = providersFrom([{ driver: "claude", label: "Claude", status: ready, models: [{ id: "haiku", label: "Haiku" }] }], [account("a"), account("b")]);
  assert.deepEqual(providers.map((provider) => [provider.label, provider.models.length, provider.accounts.map((each) => each.id)]), [["Claude", 1, ["a", "b"]]]);
});

test("a server older than harnesses still shows its accounts, with no models to pick", () => {
  const providers = providersFrom([], [account("a")]);
  assert.deepEqual(providers.map((provider) => [provider.driver, provider.label, provider.models.length, provider.accounts.length]), [["claude", "Claude", 0, 1]]);
});
