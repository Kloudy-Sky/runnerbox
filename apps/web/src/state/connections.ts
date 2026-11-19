import type { ConnectionState } from "@runnerbox/client-runtime";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { runtime } from "../runtime.ts";

// The client runtime's saved environments and their connections, as atoms, the way T3 Code's state
// reads its connection runtime. An atom built on a connection runs again only when that connection
// changes, so a reconnect brings fresh answers while the last ones stay shown.

// Everything the runtime's store holds, updated as it changes.
export const clientStateAtom = Atom.readable((get) => {
  get.addFinalizer(runtime.store.subscribe((state) => get.setSelf(state)));
  return runtime.store.getState();
});

export const environmentsAtom = Atom.readable((get) => get(clientStateAtom).environments);

type Connected = Extract<ConnectionState, { status: "connected" }>;

// One environment's connection while it's up, and null otherwise.
export const connectedAtom = Atom.family((environmentId: string) =>
  Atom.readable((get): Connected | null => {
    const connection = get(clientStateAtom).connections[environmentId];
    return connection?.status === "connected" ? connection : null;
  }),
);

// One environment's connection status, which a page shows beside what it last heard.
export const connectionStatusAtom = Atom.family((environmentId: string) => Atom.readable((get) => get(clientStateAtom).connections[environmentId]?.status));

// The methods an environment's server answers, asked once per connection. Null from a server
// older than being asked, which refuses the request as an unknown method.
export const serverMethodsAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null) return Effect.never;
    return connection.client["server.methods"]().pipe(Effect.catchDefect((defect) => (String(defect).includes("Unknown request tag") ? Effect.succeed(null) : Effect.die(defect))));
  }),
);
