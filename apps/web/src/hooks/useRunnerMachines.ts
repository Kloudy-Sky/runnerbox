import type { ConnectionState } from "@runnerbox/client-runtime";
import type { InstallExplained, InstallState } from "@runnerbox/contracts";
import { useStore } from "zustand";
import { type FreeMemory, freeMemory } from "../lib/freeMemory.ts";
import { typicalBuildMs } from "../lib/imageFacts.ts";
import { runtime } from "../runtime.ts";
import { useRpcQueryEverywhere } from "./useRpcQueryEverywhere.ts";
import { useRunnerStateEverywhere } from "./useRunnerStateEverywhere.ts";

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

// Every saved machine's runners, one entry per install. A machine with several installs gets one
// entry each; one with none, or no answer, gets a single entry with no install, so it still shows.
export function useRunnerMachines(days: number) {
  const connections = useStore(runtime.store, (state) => state.connections);
  const live = useRunnerStateEverywhere();
  // Asked again whenever a runner anywhere changes what it's doing, not on every heartbeat.
  const phases = [...live.values()]
    .flat()
    .flatMap((install) => install.kinds.flatMap((kind) => kind.slots.map((slot) => `${install.install}${kind.name}${slot.slot}${slot.phase}${slot.since}`)))
    .join();
  const explained = useRpcQueryEverywhere(["runners.explain", days, phases], (client) => client["runners.explain"]({ days }), { keepPrevious: true, refetchEvery: 30_000 });
  // Samples come once a minute, so a day thinned to 1440 points keeps every one of the last hour.
  const samples = useRpcQueryEverywhere(["samples", 1], (client) => client["runners.samples"]({ days: 1, maxPoints: 1440 }), { refetchEvery: 60_000 });
  const events = useRpcQueryEverywhere(["events", days], (client) => client["runners.events"]({ days }));
  return explained.flatMap(({ environment, data, isError }, index): RunnerMachine[] => {
    const base = { environmentId: environment.environmentId, connection: connections[environment.environmentId]?.status, note: null, now: 0, live: undefined, memory: null, typicalBuildMs: () => null };
    const alone = { ...base, key: environment.environmentId, name: environment.label, install: null };
    if (!data && isError) return [{ ...alone, note: "It didn't answer. Its server may be older than this page." }];
    if (!data) return [{ ...alone, note: base.connection === "connected" ? null : "Not connected." }];
    const now = Date.parse(data.at);
    if (data.installs.length === 0) return [{ ...alone, now, note: "Runnerbox doesn't report any runners here." }];
    return data.installs.map((install) => ({
      ...base,
      key: `${environment.environmentId}/${install.install}`,
      name: data.installs.length > 1 ? `${environment.label} · ${install.install}` : environment.label,
      install,
      now,
      live: live.get(environment.environmentId)?.find((each) => each.install === install.install),
      memory: freeMemory(samples[index]?.data ?? [], install, now),
      typicalBuildMs: (kind: string) => typicalBuildMs(events[index]?.data ?? [], install.install, kind),
    }));
  });
}
