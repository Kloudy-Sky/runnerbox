import type { ProviderStatus } from "@runnerbox/contracts";
import * as Schema from "effect/Schema";

// The drivers this server is built with. `accounts.*` and `threads.harnesses` carry Claude's alone,
// as older apps read them; `providers.*` carry each driver the server runs.
export const Driver = Schema.Literals(["claude", "codex"]);
export type Driver = typeof Driver.Type;

// The models a turn may pick, per driver. Fixed here rather than read from the CLI, so a client can
// only ever pass a name the server offered. Claude Code takes these aliases as `--model`. Codex's
// are offered only where the installed CLI lists them too.
export const HARNESSES = {
  claude: {
    label: "Claude",
    acceptsKeys: true,
    ownerLogin: false,
    models: [
      { id: "haiku", label: "Haiku" },
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "Opus" },
    ],
  },
  codex: {
    label: "Codex",
    // A key reaching `codex app-server` hasn't been checked in a real turn, so Codex accounts use
    // Runnerbox's own sign-in only, for now.
    acceptsKeys: false,
    // Or the owner's own `codex login`, by pointing Codex at their home with their MCP servers,
    // instructions and hooks turned off.
    ownerLogin: true,
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
      { id: "gpt-6-astra", label: "GPT-6 Astra" },
      { id: "gpt-6-sol", label: "GPT-6 Sol" },
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
    ],
  },
} as const satisfies Record<Driver, { readonly label: string; readonly acceptsKeys: boolean; readonly ownerLogin: boolean; readonly models: ReadonlyArray<{ readonly id: string; readonly label: string }> }>;

export const offersModel = (driver: Driver, model: string) => HARNESSES[driver].models.some((offered) => offered.id === model);

// A driver can run turns when any of its accounts can, and says its first account's fix otherwise.
export const driverStatus = (label: string, accounts: ReadonlyArray<{ readonly status: ProviderStatus }>): ProviderStatus =>
  accounts.find((account) => account.status.available)?.status ?? accounts[0]?.status ?? { provider: label, available: false, fix: "Add an account for it in Settings, Providers." };
