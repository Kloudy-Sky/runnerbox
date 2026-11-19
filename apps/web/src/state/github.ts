import type { GitHubStatus } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { polled } from "../lib/polled.ts";
import { capabilitiesAtom, connectedAtom, environmentsAtom } from "./connections.ts";

// Each machine's sign-in to GitHub as atoms: who it's signed in as, a code waiting to be approved,
// and where the App is installed.

// How long the status outlives the last page that read it, so coming back shows it at once.
const KEPT = "5 minutes";

// The status as the server last answered it, on a server that has the sign-in. Asked every half
// minute, since installs change on GitHub's own time, and every couple of seconds while a code
// waits to be approved, since the server learns of the approval on its own.
const askedAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || !get(capabilitiesAtom(environmentId)).github) return Stream.never;
    return polled(connection.client["github.status"](), "30 seconds", { every: "2 seconds", when: (status) => status.pending !== null });
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The status, which signing in, cancelling and signing out also write: each answers with the
// status as it now is, which shows until the next answer.
export const githubAtom = Atom.family((environmentId: string) =>
  Atom.writable(
    (get) => get(askedAtom(environmentId)),
    (ctx, status: GitHubStatus) => ctx.setSelf(AsyncResult.success(status)),
    (refresh) => refresh(askedAtom(environmentId)),
  ).pipe(Atom.setIdleTTL(KEPT)),
);

// The GitHub login a machine is signed in as, or null. What reads through the sign-in, such as
// reviews, asks again when it changes, and not on every answer.
export const accountAtom = Atom.family((environmentId: string) =>
  Atom.readable((get) => Option.getOrUndefined(AsyncResult.value(get(githubAtom(environmentId))))?.account ?? null),
);

// The GitHub login each saved machine is signed in as, by environment id, for the machines that
// have answered and are signed in.
export const loginsAtom = Atom.readable(
  (get) =>
    new Map(
      get(environmentsAtom).flatMap(({ environmentId }): Array<readonly [string, string]> => {
        const account = get(accountAtom(environmentId));
        return account === null ? [] : [[environmentId, account]];
      }),
    ),
);
