import type { RunnerboxClient } from "@runnerbox/client-runtime";
import type { InstallState } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { polled } from "../lib/polled.ts";
import { capabilitiesOf } from "../lib/serverCapabilities.ts";
import { connectedAtom, serverMethodsAtom } from "./connections.ts";

// Each saved machine's runners as atoms, after T3 Code's state modules: its live slot state pushed
// by its server, the answers built on it, its memory samples and launcher events, and the jobs
// GitHub has queued for it. An atom that runs again keeps its last value until the new one lands,
// so a page reading these never empties while they refresh. A machine whose connection drops
// keeps what it last heard; its stream waits for the connection rather than ending.

// How long an answer outlives the last view that read it, as React Query's cache kept them, so
// coming back to a page shows it at once.
const KEPT = "5 minutes";

// The range in days the runner views ask about, which the page sets from its URL. Every machine's
// answers follow it, so a new range runs the same atoms again, and they keep the last range's
// answer until the new one lands.
export const runnersRangeAtom = Atom.make(7).pipe(Atom.keepAlive);

// One stream per machine, opened on its live connection.
const sinceConnected = <A, E>(open: (client: RunnerboxClient) => Stream.Stream<A, E>) =>
  Atom.family((environmentId: string) =>
    Atom.make((get) => {
      const connection = get(connectedAtom(environmentId));
      return connection === null ? Stream.never : open(connection.client);
    }),
  );

// Every install's slot state, pushed whenever it changes.
export const runnerStateAtom = sinceConnected((client) => client["runners.subscribeState"]());

// Every slot's phase as one string. The answers built on it run again when a runner changes what
// it's doing, and not on the heartbeat that rewrites the state every 15 seconds.
const phasesAtom = Atom.family((environmentId: string) =>
  Atom.readable((get) =>
    Option.getOrElse(AsyncResult.value(get(runnerStateAtom(environmentId))), (): ReadonlyArray<InstallState> => [])
      .flatMap((install) => install.kinds.flatMap((kind) => kind.slots.map((slot) => `${install.install}${kind.name}${slot.slot}${slot.phase}${slot.since}`)))
      .join(),
  ),
);

// The server's sentences about each install over the range, asked again when a runner changes
// phase and every 30 seconds besides.
export const runnersExplainedAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const days = get(runnersRangeAtom);
    get(phasesAtom(environmentId));
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polled(connection.client["runners.explain"]({ days }), "30 seconds");
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The last day of machine samples, which come once a minute, so a day thinned to 1440 points keeps
// every one of the last hour.
export const runnerSamplesAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polled(connection.client["runners.samples"]({ days: 1, maxPoints: 1440 }), "60 seconds");
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// Launcher events over the range, asked once per connection and range.
export const launcherEventsAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const days = get(runnersRangeAtom);
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Effect.never : connection.client["runners.events"]({ days });
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The jobs GitHub has queued for the machine's runners, on a server that can push them. Watching
// is what makes a server ask GitHub, and an atom only runs while something reads it.
export const runnerQueueAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    const methods = AsyncResult.value(get(serverMethodsAtom(environmentId)));
    if (connection === null || Option.isNone(methods) || !capabilitiesOf(methods.value).waitingJobs) return Stream.never;
    return connection.client["runners.subscribeQueue"]();
  }),
);
