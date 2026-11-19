import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { runtime } from "../runtime.ts";

// Runnerbox Connect's sign-in on this device and the environments linked to its account, from the
// desktop app's bridge. Neither exists in a browser, which reads them as never answering.

// Whether this device is signed in to a relay, and which.
export const connectStatusAtom = Atom.make(() => {
  const connect = runtime.connect;
  return connect === undefined ? Effect.never : Effect.tryPromise(() => connect.status());
});

// The environments linked to the signed-in account, asked again with every new sign-in status.
export const linkedEnvironmentsAtom = Atom.make((get) => {
  const connect = runtime.connect;
  const status = get(connectStatusAtom);
  return connect === undefined || status._tag !== "Success" || !status.value.signedIn ? Effect.never : Effect.tryPromise(() => connect.environments());
});
