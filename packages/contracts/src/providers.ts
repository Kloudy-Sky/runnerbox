import * as Schema from "effect/Schema";
import { Account, HarnessModel, SaveAccount } from "./accounts.ts";
import { ProviderStatus } from "./threads.ts";

// What `providers.*` send: each driver this server runs, with its status, models and accounts,
// after T3 Code's provider instances. A driver travels as an open ID, not the `ProviderDriver`
// literal `accounts.*` use, so an app keeps reading a server that knows a driver it doesn't. The
// server still runs only the drivers it was built with, and refuses any other on save.

export const DriverId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/));

export const ProviderAccount = Schema.Struct({ ...Account.fields, driver: DriverId });
export type ProviderAccount = typeof ProviderAccount.Type;

export const Provider = Schema.Struct({
  driver: DriverId,
  label: Schema.String,
  // Ready when any of its accounts can run turns; otherwise the first account's fix.
  status: ProviderStatus,
  models: Schema.Array(HarnessModel),
  accounts: Schema.Array(ProviderAccount),
  // Whether an account here may have an API key, or only use the machine's sign-in. Servers from
  // before it allow keys.
  acceptsKeys: Schema.optionalKey(Schema.Boolean),
});
export type Provider = typeof Provider.Type;

export const SaveProviderAccount = Schema.Struct({ ...SaveAccount.fields, driver: DriverId });
export type SaveProviderAccount = typeof SaveProviderAccount.Type;
