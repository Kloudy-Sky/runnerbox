import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelEfforts, Provider, ProviderAccount } from "@runnerbox/contracts";
import { effortsOf, rememberedChoice, withModel } from "./turnChoice.ts";

const status = { provider: "x", available: true, fix: null };
const efforts = (...ids: string[]): ModelEfforts => ({ levels: ids.map((id) => ({ id, label: id })), default: ids[0] ?? null });
const account = (id: string, driver: string, isDefault = false, model: string | null = null): ProviderAccount => ({ id, driver, label: id, model, billing: "subscription", keyLast4: null, isDefault, builtIn: false, status });
const claude: Provider = {
  driver: "claude",
  label: "Claude",
  status,
  models: [{ id: "opus", label: "Opus", efforts: efforts("low", "max") }],
  efforts: efforts("low", "high"),
  accounts: [account("a", "claude", true), account("b", "claude", false, "opus")],
};
const codex: Provider = { driver: "codex", label: "Codex", status, models: [{ id: "gpt", label: "GPT", efforts: efforts("low", "ultra") }], accounts: [account("c", "codex")] };
const providers = [claude, codex];

test("a thread picks up its account, model and effort, or the default when the account is gone", () => {
  assert.deepEqual(rememberedChoice(providers, { accountId: "a", model: "opus", effort: "max" }), { accountId: "a", model: "opus", effort: "max" });
  assert.deepEqual(rememberedChoice(providers, { accountId: "gone", model: "opus", effort: "max" }), { accountId: "a", model: null, effort: null });
});

test("effort levels follow the model a turn runs on: the pick, else the account's own, else the driver's default", () => {
  assert.deepEqual(effortsOf(providers, { accountId: "a", model: "opus" })?.levels.map((level) => level.id), ["low", "max"]);
  assert.deepEqual(effortsOf(providers, { accountId: "b", model: null })?.levels.map((level) => level.id), ["low", "max"]);
  assert.deepEqual(effortsOf(providers, { accountId: "a", model: null })?.levels.map((level) => level.id), ["low", "high"]);
  assert.equal(effortsOf(providers, { accountId: "c", model: null }), undefined);
});

test("a new model keeps the effort only when it takes that level", () => {
  assert.deepEqual(withModel(providers, { accountId: "a", model: "opus", effort: "low" }, "c", "gpt"), { accountId: "c", model: "gpt", effort: "low" });
  assert.deepEqual(withModel(providers, { accountId: "a", model: "opus", effort: "max" }, "c", "gpt"), { accountId: "c", model: "gpt", effort: null });
});
