import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { capabilitiesAtom, connectedAtom } from "./connections.ts";

// Each machine's agent drivers and accounts, as atoms, asked once per connection: they change
// only when the owner saves one, and saving asks again.

const KEPT = "5 minutes";

// Each driver with its models and accounts, on a server that has `providers.list`.
export const providersAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null || !get(capabilitiesAtom(environmentId)).providers ? Effect.never : connection.client["providers.list"]();
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The accounts agent turns can run as, which every server answers.
export const accountsAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Effect.never : connection.client["accounts.list"]();
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The harnesses and their models, on a server older than `providers.list` that has a model menu.
export const harnessesAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null || !get(capabilitiesAtom(environmentId)).models ? Effect.never : connection.client["threads.harnesses"]();
  }).pipe(Atom.setIdleTTL(KEPT)),
);
