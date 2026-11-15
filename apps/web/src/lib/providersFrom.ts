import type { Account, Harness, Provider } from "@runnerbox/contracts";

// What a server without `providers.list` says, put in its shape: its harnesses, each with its
// accounts. A server older than `threads.harnesses` lists no models, so its accounts are grouped
// by driver on their own, with the first account's status.
export function providersFrom(harnesses: ReadonlyArray<Harness>, accounts: ReadonlyArray<Account>): ReadonlyArray<Provider> {
  if (harnesses.length > 0) return harnesses.map((harness) => ({ ...harness, accounts: accounts.filter((account) => account.driver === harness.driver) }));
  const drivers = [...new Set(accounts.map((account) => account.driver))];
  return drivers.map((driver) => {
    const own = accounts.filter((account) => account.driver === driver);
    return { driver, label: own[0]!.status.provider, status: own[0]!.status, models: [], accounts: own };
  });
}
