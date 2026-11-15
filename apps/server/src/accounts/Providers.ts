import { AccountError, type Provider, type ProviderAccount, type SaveProviderAccount } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Drivers } from "../threads/provider/Drivers.ts";
import { type Driver, driverStatus, HARNESSES } from "../threads/provider/harnesses.ts";
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

const make = Effect.gen(function* () {
  const accounts = yield* AccountStore;
  const drivers = yield* Drivers;
  const runs = (driver: string): driver is Driver => drivers.running.some((each) => each === driver);

  const list = Effect.gen(function* () {
    const all = yield* accounts.listAll;
    return yield* Effect.forEach(drivers.running, (driver) =>
      Effect.gen(function* () {
        const { label, acceptsKeys } = HARNESSES[driver];
        const own = all.filter((account) => account.driver === driver);
        return { driver, label, status: driverStatus(label, own), models: yield* drivers.get(driver).models, accounts: own, acceptsKeys } satisfies Provider;
      }),
    );
  });

  const save = Effect.fn("Providers.save")(function* ({ driver, ...input }: SaveProviderAccount) {
    if (!runs(driver)) return yield* new AccountError({ reason: "unknown_driver" });
    if (input.apiKey !== undefined && !HARNESSES[driver].acceptsKeys) return yield* new AccountError({ reason: "login_only" });
    return yield* accounts.saveAny({ ...input, driver });
  });

  return Providers.of({ list, save });
});

export const layer = Layer.effect(Providers, make);
