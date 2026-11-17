import type { HarnessModel, ModelEfforts, ProviderStatus } from "@runnerbox/contracts";
import * as Schema from "effect/Schema";

// The drivers this server is built with. `accounts.*` and `threads.harnesses` carry Claude's alone,
// as older apps read them; `providers.*` carry each driver the server runs.
export const Driver = Schema.Literals(["claude", "codex"]);
export type Driver = typeof Driver.Type;

// Each effort level's name in the composer, as T3 Code names them. A level a CLI adds that isn't
// here shows as its own ID.
const EFFORT_LABELS: Readonly<Record<string, string>> = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max", ultra: "Ultra" };
export const effortLevels = (ids: ReadonlyArray<string>, fallback: string | null): ModelEfforts => ({
  levels: ids.map((id) => ({ id, label: EFFORT_LABELS[id] ?? id })),
  default: fallback !== null && ids.includes(fallback) ? fallback : null,
});

// Claude Code's `--effort` levels, the same for every model it runs, at Claude Code's own default.
const CLAUDE_EFFORTS = effortLevels(["low", "medium", "high", "xhigh", "max"], "medium");

// The models a turn may pick, per driver. Fixed here rather than read from the CLI, so a client can
// only ever pass a name the server offered. Claude Code takes these aliases as `--model`. Codex's
// are offered only where the installed CLI lists them too, with the effort levels it lists.
// `efforts` are those of the model a turn runs on when it names none: Codex's is in its own config.
export const HARNESSES = {
  claude: {
    label: "Claude",
    acceptsKeys: true,
    ownerLogin: false,
    efforts: CLAUDE_EFFORTS,
    models: [
      { id: "haiku", label: "Haiku", efforts: CLAUDE_EFFORTS },
      { id: "sonnet", label: "Sonnet", efforts: CLAUDE_EFFORTS },
      { id: "opus", label: "Opus", efforts: CLAUDE_EFFORTS },
    ],
  },
  codex: {
    label: "Codex",
    // A key reaching `codex app-server` hasn't been checked in a real turn, so Codex accounts use a
    // sign-in in their home, never a key.
    acceptsKeys: false,
    // That home is Runnerbox's own, or the owner's, which Codex is pointed at with their MCP servers
    // and hooks off and its provider pinned to OpenAI's built-in one; their global AGENTS.md may load.
    ownerLogin: true,
    efforts: null,
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
      { id: "gpt-6-astra", label: "GPT-6 Astra" },
      { id: "gpt-6-sol", label: "GPT-6 Sol" },
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
    ],
  },
} as const satisfies Record<Driver, { readonly label: string; readonly acceptsKeys: boolean; readonly ownerLogin: boolean; readonly efforts: ModelEfforts | null; readonly models: ReadonlyArray<HarnessModel> }>;

export const offersModel = (driver: Driver, model: string) => HARNESSES[driver].models.some((offered) => offered.id === model);

// Whether a turn may run at `effort`: a level of the model it runs on, from the models the driver
// offers now, or the driver's default model's when it names none.
export const offersEffort = (driver: Driver, offered: ReadonlyArray<HarnessModel>, model: string | null, effort: string) => {
  const efforts = model === null ? HARNESSES[driver].efforts : offered.find((each) => each.id === model)?.efforts;
  return efforts?.levels.some((level) => level.id === effort) ?? false;
};

// A driver can run turns when any of its accounts can, and says its first account's fix otherwise.
export const driverStatus = (label: string, accounts: ReadonlyArray<{ readonly status: ProviderStatus }>): ProviderStatus =>
  accounts.find((account) => account.status.available)?.status ?? accounts[0]?.status ?? { provider: label, available: false, fix: "Add an account for it in Settings, Providers." };
