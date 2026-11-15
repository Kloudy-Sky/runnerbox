import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { type Driver, HARNESSES } from "./harnesses.ts";
import { CodexProviderAdapter, ProviderAdapter, ProviderError } from "./ProviderAdapter.ts";

// The adapter for each driver an account can name, and which drivers this server runs. Claude
// always; Codex only when the server was given its adapter. An account on a driver the server
// doesn't run stays stored but isn't listed, and a turn naming it is refused.
export class Drivers extends Context.Service<
  Drivers,
  {
    readonly get: (driver: Driver) => ProviderAdapter["Service"];
    readonly running: ReadonlyArray<Driver>;
  }
>()("runnerbox/server/threads/Drivers") {}

const off = (driver: Driver): ProviderAdapter["Service"] => {
  const message = `${HARNESSES[driver].label} is off on this server.`;
  return {
    status: () => Effect.succeed({ provider: HARNESSES[driver].label, available: false, fix: message }),
    models: Effect.succeed([]),
    runTurn: () => Stream.fail(new ProviderError({ message })),
  };
};

export const layer = Layer.effect(
  Drivers,
  Effect.gen(function* () {
    const claude = yield* ProviderAdapter;
    const codex = yield* Effect.serviceOption(CodexProviderAdapter);
    const adapters: Record<Driver, ProviderAdapter["Service"]> = { claude, codex: Option.getOrElse(codex, () => off("codex")) };
    const running: ReadonlyArray<Driver> = Option.isSome(codex) ? ["claude", "codex"] : ["claude"];
    return Drivers.of({ get: (driver) => adapters[driver], running });
  }),
);
