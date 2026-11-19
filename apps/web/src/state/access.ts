import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import { latest, polledOrFailed } from "../lib/polled.ts";
import { connectedAtom } from "./connections.ts";

// Every device and agent paired with a machine, and when each was last seen. Asked every minute,
// since a device can pair from elsewhere at any time, and again at once after a revoke.
export const sessionsAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polledOrFailed(connection.client["access.sessions"](), "60 seconds");
  }).pipe(latest, Atom.setIdleTTL("5 minutes")),
);
