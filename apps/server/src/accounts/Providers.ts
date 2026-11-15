import { AccountError, type Provider, ProviderDriver, type ProviderAccount, type SaveProviderAccount } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { driverStatus, HARNESSES } from "../threads/provider/harnesses.ts";
import { AccountStore } from "./AccountStore.ts";

// The drivers this server runs, each with its models and accounts, for `providers.*`. Accounts are
// still AccountStore's; this groups them by driver and checks a driver ID from the wire before
// anything is saved under it.
export class Providers extends Context.Service<
  Providers,
  {
    readonly list: Effect.Effect<ReadonlyArray<Provider>, AccountError>;
    readonly save: (input: SaveProviderAccount) => Effect.Effect<ProviderAccount, AccountError>;
  }
>()("runnerbox/server/accounts/Providers") {}

const isDriver = Schema.is(ProviderDriver);

const make = Effect.gen(function* () {
  const accounts = yield* AccountStore;

  const list = accounts.list.pipe(
    Effect.map((all) =>
      ProviderDriver.literals.map((driver): Provider => {
        const { label, models } = HARNESSES[driver];
        const own = all.filter((account) => account.driver === driver);
        return { driver, label, status: driverStatus(label, own), models, accounts: own };
      }),
    ),
  );

  const save = Effect.fn("Providers.save")(function* ({ driver, ...input }: SaveProviderAccount) {
    if (!isDriver(driver)) return yield* new AccountError({ reason: "unknown_driver" });
    return yield* accounts.save({ ...input, driver });
  });

  return Providers.of({ list, save });
});

export const layer = Layer.effect(Providers, make);
