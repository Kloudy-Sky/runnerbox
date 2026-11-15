import * as Schema from "effect/Schema";
import { ProviderStatus } from "./threads.ts";

// Who an agent turn runs as. An account is a driver (Claude today, Codex later), a label, an
// optional model, and for an API account a key. "Claude, subscription" always exists and uses the
// login on the environment's machine.

export const ProviderDriver = Schema.Literals(["claude"]);
export type ProviderDriver = typeof ProviderDriver.Type;

export const BUILT_IN_ACCOUNT_ID = "claude-subscription";

export const AccountId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/));
export const ModelName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/));
export const AccountLabel = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60));
// Write-only: it goes to the server and is never sent back.
export const ApiKey = Schema.String.check(Schema.isPattern(/^\S{8,512}$/));

// A harness is a driver as the composer offers it: whether it can run here, and the models the
// server lets a turn pick. The list is the server's, so a client can't name a model it didn't offer.
export const HarnessModel = Schema.Struct({ id: Schema.String, label: Schema.String });
export const Harness = Schema.Struct({
  driver: ProviderDriver,
  label: Schema.String,
  status: ProviderStatus,
  models: Schema.Array(HarnessModel),
});
export type Harness = typeof Harness.Type;

// An account as clients see it: never the key, only its last four characters.
export const Account = Schema.Struct({
  id: Schema.String,
  driver: ProviderDriver,
  label: Schema.String,
  model: Schema.NullOr(Schema.String),
  billing: Schema.Literals(["subscription", "api_key"]),
  keyLast4: Schema.NullOr(Schema.String),
  isDefault: Schema.Boolean,
  builtIn: Schema.Boolean,
  status: ProviderStatus,
});
export type Account = typeof Account.Type;

// Adds an account, or changes one when `id` is given. Leaving `apiKey` out keeps the key it has;
// the built-in account can't take one.
export const SaveAccount = Schema.Struct({
  id: Schema.optionalKey(AccountId),
  driver: ProviderDriver,
  label: AccountLabel,
  model: Schema.NullOr(ModelName),
  apiKey: Schema.optionalKey(ApiKey),
});
export type SaveAccount = typeof SaveAccount.Type;

export class AccountError extends Schema.TaggedError<AccountError>()("AccountError", {
  reason: Schema.Literals(["not_found", "built_in", "unreadable", "unknown_driver"]),
}) {
  override get message() {
    switch (this.reason) {
      case "not_found":
        return "No account has that ID.";
      case "built_in":
        return "The subscription account can't be removed or given a key.";
      case "unreadable":
        return "Couldn't read or write the accounts file on the server.";
      case "unknown_driver":
        return "This server can't run that provider.";
    }
  }
}
