// A stand-in of runnerbox's, not T3 Code's file: the provider instances the copied model picker
// sidebar lists. Runnerbox's instances are its accounts, each under the driver it runs on.
import type { Provider } from "@runnerbox/contracts";
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  readonly enabled: boolean;
  readonly isAvailable: boolean;
  // T3 Code's states; runnerbox's entries are only ever ready or in error.
  readonly status: "ready" | "warning" | "error" | "disabled";
  readonly snapshot: { readonly message?: string | null | undefined };
}

export function isProviderInstancePickerReady(entry: ProviderInstanceEntry): boolean {
  return entry.enabled && entry.isAvailable && entry.status === "ready";
}

// As T3 Code's: a badge tells apart instances that share a driver.
export function shouldShowInstanceBadge(entry: ProviderInstanceEntry, entries: Iterable<ProviderInstanceEntry>): boolean {
  let shared = 0;
  for (const candidate of entries) if (candidate.driverKind === entry.driverKind && ++shared > 1) return true;
  return false;
}

// One entry per account, named for its driver when it's the driver's only account.
export function providerInstanceEntries(providers: ReadonlyArray<Provider>): ReadonlyArray<ProviderInstanceEntry> {
  return providers.flatMap((provider) =>
    provider.accounts.map((account) => {
      const ready = account.status.available;
      return {
        instanceId: account.id,
        driverKind: provider.driver,
        displayName: provider.accounts.length > 1 ? account.label : provider.label,
        enabled: true,
        isAvailable: ready,
        status: ready ? "ready" : "error",
        snapshot: { message: account.status.fix ?? provider.status.fix },
      };
    }),
  );
}
