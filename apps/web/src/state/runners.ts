import type { RunnerboxClient } from "@runnerbox/client-runtime";
import type { InstallState } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { capabilitiesOf } from "../lib/serverCapabilities.ts";
import { connectedAtom, serverMethodsAtom } from "./connections.ts";

// Each saved machine's runners as atoms, after T3 Code's state modules: its live slot state pushed
// by its server, the answers built on it, its memory samples and launcher events, and the jobs
// GitHub has queued for it. An atom that runs again keeps its last value until the new one lands,
// so a page reading these never empties while they refresh. A machine whose connection drops
// keeps what it last heard; its stream waits for the connection rather than ending.

// `Atom.family` holds what it returns only weakly, so a family of families would lose an inner one
// to the garbage collector and hand out a new atom, with none of the old one's value, for the same
// machine. An atom keyed by days and machine takes both in one key instead.
const byDays = (days: number, environmentId: string) => `${days}\u0000${environmentId}`;
const fromKey = (key: string) => {
  const [days = "", environmentId = ""] = key.split("\u0000");
  return { days: Number(days), environmentId };
};

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

// The server's sentences about each install over the last `days`, asked again when a runner
// changes phase and every 30 seconds besides.
const runnersExplainedFamily = Atom.family((key: string) =>
  Atom.make((get) => {
    const { days, environmentId } = fromKey(key);
    get(phasesAtom(environmentId));
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : Stream.fromEffectSchedule(connection.client["runners.explain"]({ days }), Schedule.spaced("30 seconds"));
  }),
);
export const runnersExplainedAtom = (days: number, environmentId: string) => runnersExplainedFamily(byDays(days, environmentId));

// The last day of machine samples, which come once a minute, so a day thinned to 1440 points keeps
// every one of the last hour.
export const runnerSamplesAtom = sinceConnected((client) => Stream.fromEffectSchedule(client["runners.samples"]({ days: 1, maxPoints: 1440 }), Schedule.spaced("60 seconds")));

// Launcher events over the last `days`, asked once per connection.
const launcherEventsFamily = Atom.family((key: string) =>
  Atom.make((get) => {
    const { days, environmentId } = fromKey(key);
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Effect.never : connection.client["runners.events"]({ days });
  }),
);
export const launcherEventsAtom = (days: number, environmentId: string) => launcherEventsFamily(byDays(days, environmentId));

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
