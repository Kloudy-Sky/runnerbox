import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// The ports this server's listeners actually bound, filled in once each one is up. A listener
// asked for port 0 gets one from the system, so whatever calls back reads it here rather than
// trusting the port it asked for.
export class ListeningPorts extends Context.Service<ListeningPorts, { readonly local: Deferred.Deferred<number>; readonly tunnel: Deferred.Deferred<number> }>()(
  "runnerbox/server/ListeningPorts",
) {}

// A port asked for by number is known now; one asked for as 0 is known once its listener binds.
const portOf = (asked: number | null) =>
  Effect.tap(Deferred.make<number>(), (port) => (asked === null || asked === 0 ? Effect.void : Deferred.succeed(port, asked)));

export const layer = (asked: { readonly port: number; readonly tunnelPort: number | null }) =>
  Layer.effect(ListeningPorts, Effect.all({ local: portOf(asked.port), tunnel: portOf(asked.tunnelPort) }).pipe(Effect.map(ListeningPorts.of)));
