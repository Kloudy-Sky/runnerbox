import type { ModelEfforts, Provider, ProviderAccount } from "@runnerbox/contracts";

// What the next turn runs on: an account, which names its driver, a model on that driver or none for
// the account's own setting, and an effort level of that model or none for its default. They change
// together, so a model never outlives its driver and an effort never outlives its model.
export type TurnChoice = { readonly accountId: string | undefined; readonly model: string | null; readonly effort: string | null };

const accountsOf = (providers: ReadonlyArray<Provider>) => providers.flatMap((provider) => provider.accounts);
// A server that lists no models for a driver still knows the one a thread ran on.
const offers = (provider: Provider | undefined, model: string) => provider !== undefined && (provider.models.length === 0 || provider.models.some((each) => each.id === model));

// The account a choice runs as, and its driver's provider.
export function choiceAccount(providers: ReadonlyArray<Provider>, accountId: string | undefined): { readonly account: ProviderAccount; readonly provider: Provider } | undefined {
  const provider = providers.find((each) => each.accounts.some((account) => account.id === accountId));
  const account = provider?.accounts.find((each) => each.id === accountId);
  return provider && account ? { account, provider } : undefined;
}

// The effort levels of the model a choice runs on: the one picked, else the account's own, else the
// driver's default model's. None when the server didn't list any for it.
export function effortsOf(providers: ReadonlyArray<Provider>, choice: Pick<TurnChoice, "accountId" | "model">): ModelEfforts | undefined {
  const found = choiceAccount(providers, choice.accountId);
  if (!found) return undefined;
  const model = choice.model ?? found.account.model;
  return model === null ? found.provider.efforts : found.provider.models.find((each) => each.id === model)?.efforts;
}

const keptEffort = (providers: ReadonlyArray<Provider>, next: Pick<TurnChoice, "accountId" | "model">, effort: string | null | undefined) =>
  effort != null && effortsOf(providers, next)?.levels.some((level) => level.id === effort) ? effort : null;

// What a thread last ran on, if its account still exists, or the default account on its own
// setting, so a thread whose account was removed stays usable.
export function rememberedChoice(
  providers: ReadonlyArray<Provider>,
  last: { readonly accountId?: string | undefined; readonly model?: string | undefined; readonly effort?: string | undefined } | undefined,
): TurnChoice {
  const found = choiceAccount(providers, last?.accountId);
  if (!found) return { accountId: accountsOf(providers).find((each) => each.isDefault)?.id, model: null, effort: null };
  const next = { accountId: found.account.id, model: last?.model !== undefined && offers(found.provider, last.model) ? last.model : null };
  return { ...next, effort: keptEffort(providers, next, last?.effort) };
}

// A model picked under an account. The effort carries over when the new model takes it too.
export function withModel(providers: ReadonlyArray<Provider>, choice: TurnChoice, accountId: string, model: string | null): TurnChoice {
  const next = { accountId, model };
  return { ...next, effort: keptEffort(providers, next, choice.effort) };
}
