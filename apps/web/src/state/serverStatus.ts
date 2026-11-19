import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { answerOf } from "../lib/answer.ts";
import { latest, polledOrFailed } from "../lib/polled.ts";
import { capabilitiesOf } from "../lib/serverCapabilities.ts";
import { capabilitiesAtom, connectedAtom, environmentsAtom, serverMethodsAtom } from "./connections.ts";

// What each machine's server says about itself, as atoms: its version, whether it can update now,
// whether a release is signed, and when an install's runners restart.

const KEPT = "5 minutes";

// The server's version and protocol, asked once per connection: they change only with a restart.
export const aboutAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Effect.never : connection.client["server.about"]();
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// What holds an update back on a server that updates itself, asked every half minute, since work
// that blocks one starts and stops at any time.
export const updateStatusAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || !get(capabilitiesAtom(environmentId)).serverUpdate) return Stream.never;
    return polledOrFailed(connection.client["server.updateStatus"](), "30 seconds");
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

// Whether a release is signed, asked once, on a server that checks. The check goes to GitHub.
export const releaseSignatureAtom = Atom.family(({ environmentId, version }: { readonly environmentId: string; readonly version: string }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || !get(capabilitiesAtom(environmentId)).checkRelease) return Effect.never;
    return connection.client["server.checkRelease"]({ version });
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// Whether an install's runners can restart onto a new version, and how the last restart went,
// asked every half minute while one waits for a moment without a running job.
export const restartStatusAtom = Atom.family(({ environmentId, install }: { readonly environmentId: string; readonly install: string }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || !get(capabilitiesAtom(environmentId)).restartRunners) return Stream.never;
    return polledOrFailed(connection.client["runners.restartStatus"]({ install }), "30 seconds");
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

// What the sidebar's Update needs from every saved machine: its connection, version and methods,
// and, while `asking` for `target`, whether it can update now and whether that release is signed.
// Only a machine this device may update, reached by address or SSH, is asked those two.
export const updateFactsAtom = Atom.family(({ asking, target }: { readonly asking: boolean; readonly target: string | null }) =>
  Atom.readable((get) =>
    get(environmentsAtom).map((environment) => {
      const { environmentId } = environment;
      const connection = get(connectedAtom(environmentId));
      const methods = get(serverMethodsAtom(environmentId));
      const capabilities = Option.match(AsyncResult.value(methods), { onNone: () => null, onSome: capabilitiesOf });
      const askable = asking && target !== null && connection !== null && connection.route.kind !== "connect" && environment.scopes.includes("access:write") && capabilities?.serverUpdate === true;
      return {
        environment,
        connection,
        about: answerOf(get(aboutAtom(environmentId))),
        methodsFailed: AsyncResult.isFailure(methods),
        capabilities,
        status: askable ? answerOf(get(updateStatusAtom(environmentId))) : undefined,
        release: askable && capabilities?.checkRelease ? answerOf(get(releaseSignatureAtom({ environmentId, version: target }))) : undefined,
      };
    }),
  ),
);
