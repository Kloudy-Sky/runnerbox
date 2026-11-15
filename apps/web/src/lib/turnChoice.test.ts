import assert from "node:assert/strict";
import { test } from "node:test";
import type { Provider, ProviderAccount } from "@runnerbox/contracts";
import { rememberedChoice, withAccount, withModel } from "./turnChoice.ts";

const status = { provider: "x", available: true, fix: null };
const account = (id: string, driver: string, isDefault = false): ProviderAccount => ({ id, driver, label: id, model: null, billing: "subscription", keyLast4: null, isDefault, builtIn: false, status });
const claude: Provider = { driver: "claude", label: "Claude", status, models: [{ id: "opus", label: "Opus" }], accounts: [account("a", "claude", true), account("b", "claude")] };
const codex: Provider = { driver: "codex", label: "Codex", status, models: [{ id: "gpt", label: "GPT" }], accounts: [account("c", "codex")] };
const providers = [claude, codex];

test("a thread picks up its account and model, or the default when the account is gone", () => {
  assert.deepEqual(rememberedChoice(providers, { accountId: "b", model: "opus" }), { accountId: "b", model: "opus" });
  assert.deepEqual(rememberedChoice(providers, { accountId: "gone", model: "opus" }), { accountId: "a", model: null });
});

test("a model under another driver moves the turn to that driver's account", () => {
  assert.deepEqual(withModel(providers, { accountId: "b", model: "opus" }, "codex", "gpt"), { accountId: "c", model: "gpt" });
  assert.deepEqual(withModel(providers, { accountId: "a", model: null }, "claude", "opus"), { accountId: "a", model: "opus" });
});

test("an account on another driver drops the model, one on the same driver keeps it", () => {
  assert.deepEqual(withAccount(providers, { accountId: "a", model: "opus" }, account("c", "codex")), { accountId: "c", model: null });
  assert.deepEqual(withAccount(providers, { accountId: "a", model: "opus" }, account("b", "claude")), { accountId: "b", model: "opus" });
});
