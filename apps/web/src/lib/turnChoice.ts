import type { Provider, ProviderAccount } from "@runnerbox/contracts";

// What the next turn runs on: an account, which names its driver, and a model on that driver, or
// none for the account's own setting. They change together, so a model never outlives its driver.
export type TurnChoice = { readonly accountId: string | undefined; readonly model: string | null };

const accountsOf = (providers: ReadonlyArray<Provider>) => providers.flatMap((provider) => provider.accounts);
const driverOf = (providers: ReadonlyArray<Provider>, accountId: string | undefined) => accountsOf(providers).find((account) => account.id === accountId)?.driver;
// A server that lists no models for a driver still knows the one a thread ran on.
const offers = (provider: Provider | undefined, model: string) => provider !== undefined && (provider.models.length === 0 || provider.models.some((each) => each.id === model));

// What a thread last ran on, if its account still exists, or the default account on its own
// setting, so a thread whose account was removed stays usable.
export function rememberedChoice(providers: ReadonlyArray<Provider>, last: { readonly accountId?: string | undefined; readonly model?: string | undefined } | undefined): TurnChoice {
  const accounts = accountsOf(providers);
  const account = accounts.find((each) => each.id === last?.accountId);
  if (!account) return { accountId: accounts.find((each) => each.isDefault)?.id, model: null };
  const provider = providers.find((each) => each.driver === account.driver);
  return { accountId: account.id, model: last?.model !== undefined && offers(provider, last.model) ? last.model : null };
}

// A model picked under a driver moves the turn to that driver's default account when it was on
// another driver's.
export function withModel(providers: ReadonlyArray<Provider>, choice: TurnChoice, driver: string, model: string | null): TurnChoice {
  if (driverOf(providers, choice.accountId) === driver) return { ...choice, model };
  const own = providers.find((each) => each.driver === driver)?.accounts ?? [];
  return { accountId: (own.find((each) => each.isDefault) ?? own[0])?.id, model };
}

// An account on another driver drops the model, which belongs to the driver it leaves.
export function withAccount(providers: ReadonlyArray<Provider>, choice: TurnChoice, account: ProviderAccount): TurnChoice {
  return { accountId: account.id, model: driverOf(providers, choice.accountId) === account.driver ? choice.model : null };
}
