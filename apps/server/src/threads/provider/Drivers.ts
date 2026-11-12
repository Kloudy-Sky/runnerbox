import type { ProviderDriver } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProviderAdapter } from "./ProviderAdapter.ts";

// The adapter for each driver an account can name. Claude is the only one today; a Codex adapter
// would be one more entry here, and nothing that runs turns would change.
export class Drivers extends Context.Service<Drivers, { readonly get: (driver: ProviderDriver) => ProviderAdapter["Service"] }>()(
  "runnerbox/server/threads/Drivers",
) {}

export const layer = Layer.effect(
  Drivers,
  Effect.gen(function* () {
    const adapters: Record<ProviderDriver, ProviderAdapter["Service"]> = { claude: yield* ProviderAdapter };
    return Drivers.of({ get: (driver) => adapters[driver] });
  }),
);
