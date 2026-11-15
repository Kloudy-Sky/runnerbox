import type { ProviderDriver, ProviderStatus } from "@runnerbox/contracts";

// The models a turn may pick, per driver. Fixed here rather than read from the CLI, so a client can
// only ever pass a name the server offered. Claude Code takes these aliases as `--model`. A Codex
// driver adds its own entry.
export const HARNESSES = {
  claude: {
    label: "Claude",
    models: [
      { id: "haiku", label: "Haiku" },
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "Opus" },
    ],
  },
} as const satisfies Record<ProviderDriver, { readonly label: string; readonly models: ReadonlyArray<{ readonly id: string; readonly label: string }> }>;

export const offersModel = (driver: ProviderDriver, model: string) => HARNESSES[driver].models.some((offered) => offered.id === model);

// A driver can run turns when any of its accounts can, and says its first account's fix otherwise.
export const driverStatus = (label: string, accounts: ReadonlyArray<{ readonly status: ProviderStatus }>): ProviderStatus =>
  accounts.find((account) => account.status.available)?.status ?? accounts[0]?.status ?? { provider: label, available: false, fix: "Add an account for it in Settings, Providers." };
