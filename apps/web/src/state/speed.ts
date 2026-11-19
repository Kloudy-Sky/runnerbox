import type { GroupBy } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import { latest, polledOrFailed } from "../lib/polled.ts";
import { capabilitiesAtom, connectedAtom } from "./connections.ts";
import { everywhere } from "./everywhere.ts";

// What Speed and cost reads from each machine, as atoms: what its runners did and cost, its health,
// and the job history it builds trends and tables from. These move slowly, so each is asked every
// five minutes, and a failure shows beside the last answer until an ask answers. An answer about a
// repository carries it, so a page keeping the last answer on screen while the next loads never
// shows one repository's jobs under another's name.

const KEPT = "5 minutes";
const EVERY = "5 minutes";

type Days = { readonly environmentId: string; readonly days: number };
type RepoDays = Days & { readonly repo: string };

// Each kind of runner's time and what GitHub would have charged for it.
export const kindUsageAtom = Atom.family(({ environmentId, days }: Days) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polledOrFailed(connection.client["history.kindUsage"]({ days }), EVERY);
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);
export const kindUsageEverywhereAtom = Atom.family((days: number) => everywhere((environmentId) => kindUsageAtom({ environmentId, days })));

// Whether each install took jobs, its lowest free memory each day, and jobs it failed.
export const healthAtom = Atom.family(({ environmentId, days }: Days) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polledOrFailed(connection.client["runners.health"]({ days }), EVERY);
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);
export const healthEverywhereAtom = Atom.family((days: number) => everywhere((environmentId) => healthAtom({ environmentId, days })));

// How each job's time changed over the range, on a server that has Speed and cost's questions.
// Nothing is asked until the repository is known.
export const jobTrendsAtom = Atom.family(({ environmentId, repo, days }: Days & { readonly repo: string | undefined }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || repo === undefined || !get(capabilitiesAtom(environmentId)).speed) return Stream.never;
    return polledOrFailed(connection.client["history.jobTrends"]({ repo, days }).pipe(Effect.map((trends) => ({ trends, repo }))), EVERY);
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

// Typical job time and wait across every repository, on a server that has Speed and cost's questions.
export const overviewAtom = Atom.family(({ environmentId, days }: Days) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || !get(capabilitiesAtom(environmentId)).speed) return Stream.never;
    return polledOrFailed(connection.client["history.overview"]({ days }), EVERY);
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

// How long each job takes on each kind of runner, grouped by label or runner name.
export const weeklySummaryAtom = Atom.family(({ environmentId, repo, days, by }: RepoDays & { readonly by: GroupBy }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polledOrFailed(connection.client["history.weeklySummary"]({ repo, days, by }).pipe(Effect.map((answer) => ({ ...answer, repo }))), EVERY);
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

type Steps = RepoDays & { readonly by: GroupBy; readonly workflow: string | null; readonly job: string };

// Where one job's steps spend their time on each kind of runner. The answer carries the job, so
// while another job's steps load the heading still names the job whose steps are shown.
export const stepComparisonAtom = Atom.family(({ environmentId, repo, days, by, workflow, job }: Steps) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null) return Stream.never;
    const ask = connection.client["history.stepComparison"]({ repo, days, by, job, ...(workflow ? { workflow } : {}) });
    return polledOrFailed(ask.pipe(Effect.map((comparison) => ({ ...comparison, repo, workflow, job }))), EVERY);
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

// The machine's samples over the range, thinned to at most `maxPoints`.
export const samplesAtom = Atom.family(({ environmentId, days, maxPoints }: Days & { readonly maxPoints: number }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polledOrFailed(connection.client["runners.samples"]({ days, maxPoints }), EVERY);
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);
