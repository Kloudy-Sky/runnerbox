import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { latest, polledOrFailed } from "../lib/polled.ts";
import { capabilitiesAtom, connectedAtom, environmentsAtom } from "./connections.ts";

// Each machine's job history as atoms: the repositories it has logs for, a repository's runs over a
// range, and one job attempt's steps, memory and CPU.

// How long an answer outlives the last page that read it, so coming back shows it at once.
const KEPT = "5 minutes";

// The repositories a machine has job logs for, asked every five minutes, since a new one appears
// only with its first job. A failure shows until an ask answers.
export const reposAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polledOrFailed(connection.client["history.repos"](), "5 minutes");
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

// Every repository any saved machine has job logs for, each once.
export const reposEverywhereAtom = Atom.readable((get) => [
  ...new Set(get(environmentsAtom).flatMap(({ environmentId }) => Option.getOrElse(AsyncResult.value(get(reposAtom(environmentId))), (): ReadonlyArray<string> => []))),
]);

type Runs = { readonly environmentId: string; readonly repo: string | undefined; readonly days: number };

// A repository's runs over the last `days` on a machine, the newest first, asked every minute,
// since jobs finish all the time. A failure shows beside the last list until an ask answers. Nothing
// is asked until the repository is known.
export const runsAtom = Atom.family(({ environmentId, repo, days }: Runs) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null || repo === undefined ? Stream.never : polledOrFailed(connection.client["history.runs"]({ repo, days, limit: 2000 }), "60 seconds");
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

type Job = { readonly environmentId: string; readonly repo: string; readonly jobId: number };

// One job attempt's steps, memory and CPU, asked once, on a server new enough to have them.
export const jobResourcesAtom = Atom.family(({ environmentId, repo, jobId }: Job) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null || !get(capabilitiesAtom(environmentId)).jobResources ? Effect.never : connection.client["history.jobResources"]({ repo, jobId });
  }).pipe(Atom.setIdleTTL(KEPT)),
);
