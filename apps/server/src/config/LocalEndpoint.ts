import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ListeningPorts } from "./ListeningPorts.ts";

// Where this server answers on its own machine, for a process it starts that calls back, such as
// a thread's agent reaching `/mcp`. A wildcard bind is reached over loopback. It waits for the
// listener to be up, so it names the port really bound.
export class LocalEndpoint extends Context.Service<LocalEndpoint, { readonly baseUrl: Effect.Effect<string> }>()("runnerbox/server/LocalEndpoint") {}

const reachable = (host: string) => (host === "0.0.0.0" || host === "::" || host === "" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host);

export const layer = (host: string) =>
  Layer.effect(
    LocalEndpoint,
    Effect.gen(function* () {
      const { local } = yield* ListeningPorts;
      return LocalEndpoint.of({ baseUrl: Deferred.await(local).pipe(Effect.map((port) => `http://${reachable(host)}:${port}`)) });
    }),
  );
