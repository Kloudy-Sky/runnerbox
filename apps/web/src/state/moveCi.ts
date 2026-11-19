import type { MoveCiView } from "@runnerbox/contracts";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { polled } from "../lib/polled.ts";
import { capabilitiesAtom, connectedAtom } from "./connections.ts";
import { runnersRangeAtom } from "./runners.ts";

// Where each job on a machine's installed repositories picks its runner, as atoms. The server asks
// GitHub no more than once a minute, so asking it more often would only repeat its last answer.

// How long the view outlives the last page that read it, so coming back to Runners shows it at once.
const KEPT = "5 minutes";

// The view as the server last answered it, on a server that has Move CI.
const askedAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || !get(capabilitiesAtom(environmentId)).moveCi) return Stream.never;
    return polled(connection.client["moveCi.status"](), "60 seconds");
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// Where each repository's jobs ran over the Runners page's range, for the runs bar beside its
// switch, so a move can be checked against where runs then went.
export const whereRanAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const days = get(runnersRangeAtom);
    const connection = get(connectedAtom(environmentId));
    if (connection === null || !get(capabilitiesAtom(environmentId)).whereRan) return Stream.never;
    return polled(connection.client["history.whereRan"]({ days }), "60 seconds");
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The view, which the switch can also write: `moveCi.setRunner` answers with the view as it now
// is, and that shows until the next answer, which the server builds from the same rows. It's kept
// as long as the answers are, or a page left and come back to before then would show the runner
// from before the switch.
export const moveCiAtom = Atom.family((environmentId: string) =>
  Atom.writable(
    (get) => get(askedAtom(environmentId)),
    (ctx, view: MoveCiView) => ctx.setSelf(AsyncResult.success(view)),
    (refresh) => refresh(askedAtom(environmentId)),
  ).pipe(Atom.setIdleTTL(KEPT)),
);
