import type { ProviderAccount } from "@runnerbox/contracts";

export const billingWords = (account: ProviderAccount) => (account.billing === "api_key" ? `Key ending ${account.keyLast4}` : "Login on this machine");
export const statusWords = (account: ProviderAccount) => (!account.status.available ? "Not ready" : account.billing === "api_key" ? "Key set" : "Signed in");
