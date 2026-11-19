import type { ConnectionState } from "@runnerbox/client-runtime";
import type { InstallExplained, InstallState, QueueView } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { type FreeMemory, freeMemory } from "../lib/freeMemory.ts";
import { typicalBuildMs } from "../lib/imageFacts.ts";
import { clientStateAtom, connectedAtom, environmentsAtom } from "./connections.ts";
import { launcherEventsAtom, runnerQueueAtom, runnersExplainedAtom, runnerSamplesAtom, runnerStateAtom } from "./runners.ts";

// What the Runners page, the sidebar and the overview draw from the runner atoms, across every
// saved machine.

// One install on one saved machine, as the Runners page draws it. `key` is what the URL's `machine`
// holds when the page is narrowed to it. With no install, `note` says why in a sentence, or is
// null while the first answer loads. `now` is the moment its server wrote the answer, which every
// age and the hour of its lanes are measured from.
export type RunnerMachine = {
  readonly key: string;
  readonly environmentId: string;
  readonly name: string;
  readonly connection: ConnectionState["status"] | undefined;
  readonly install: InstallExplained | null;
  readonly note: string | null;
  readonly now: number;
  readonly live: InstallState | undefined;
  readonly memory: FreeMemory | null;
  readonly typicalBuildMs: (kind: string) => number | null;
};

const valueOf = <A, E>(result: AsyncResult.AsyncResult<A, E>) => Option.getOrUndefined(AsyncResult.value(result));

// Every saved machine's live slot state, by environment id. A machine appears with its first push
// and keeps its last state while it's disconnected.
export const runnerStateEverywhereAtom = Atom.readable(
  (get) =>
    new Map(
      get(environmentsAtom).flatMap(({ environmentId }) => {
        const installs = valueOf(get(runnerStateAtom(environmentId)));
        return installs ? [[environmentId, installs] as const] : [];
      }),
    ),
);

// The jobs GitHub has queued for each machine's runners, by environment id. Only connected
// machines count: a disconnected one's last push would keep a job it can no longer see as waiting.
export const runnerQueueEverywhereAtom = Atom.readable(
  (get) =>
    new Map(
      get(environmentsAtom).flatMap(({ environmentId }): Array<readonly [string, QueueView]> => {
        const queue = valueOf(get(runnerQueueAtom(environmentId)));
        return queue && get(connectedAtom(environmentId)) !== null ? [[environmentId, queue]] : [];
      }),
    ),
);

// Every saved machine's runners over the range in `runnersRangeAtom`, one entry per install. A
// machine with several installs gets one entry each; one with none, or no answer, gets a single
// entry with no install, so it still shows.
export const runnerMachinesAtom = Atom.readable((get) => {
  const { connections } = get(clientStateAtom);
  const live = get(runnerStateEverywhereAtom);
  return get(environmentsAtom).flatMap((environment): RunnerMachine[] => {
    const { environmentId } = environment;
    const explained = get(runnersExplainedAtom(environmentId));
    const data = valueOf(explained);
    const base = { environmentId, connection: connections[environmentId]?.status, note: null, now: 0, live: undefined, memory: null, typicalBuildMs: () => null };
    const alone = { ...base, key: environmentId, name: environment.label, install: null };
    if (!data && AsyncResult.isFailure(explained)) return [{ ...alone, note: "It didn't answer. Its server may be older than this page." }];
    if (!data) return [{ ...alone, note: base.connection === "connected" ? null : "Not connected." }];
    const now = Date.parse(data.at);
    if (data.installs.length === 0) return [{ ...alone, now, note: "Runnerbox doesn't report any runners here." }];
    const samples = valueOf(get(runnerSamplesAtom(environmentId))) ?? [];
    const events = valueOf(get(launcherEventsAtom(environmentId))) ?? [];
    return data.installs.map((install) => ({
      ...base,
      key: `${environmentId}/${install.install}`,
      name: data.installs.length > 1 ? `${environment.label} · ${install.install}` : environment.label,
      install,
      now,
      live: live.get(environmentId)?.find((each) => each.install === install.install),
      memory: freeMemory(samples, install, now),
      typicalBuildMs: (kind: string) => typicalBuildMs(events, install.install, kind),
    }));
  });
});
