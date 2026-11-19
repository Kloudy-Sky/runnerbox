import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { RepoRuns, RunnerVariable } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { capabilitiesOf, NO_CAPABILITIES } from "../lib/serverCapabilities.ts";
import { runtime } from "../runtime.ts";
import { serverMethodsAtom } from "../state/connections.ts";
import { moveCiAtom, whereRanAtom } from "../state/moveCi.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// Where each job on the active environment's installed repositories picks its runner, the patch
// that moves the rest, and the switch that sets their runner variable. `canSet` is false on a
// server older than the switch. `runs` is where each repository's jobs ran over the page's range,
// by repository: null on a server too old to say, and "unknown" until it has answered.
export function useMoveCi() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const status = useAtomValue(moveCiAtom(environmentId));
  const ran = useAtomValue(whereRanAtom(environmentId));
  const methods = useAtomValue(serverMethodsAtom(environmentId));
  const write = useAtomSet(moveCiAtom(environmentId));
  const capabilities = Option.match(AsyncResult.value(methods), { onNone: () => NO_CAPABILITIES, onSome: capabilitiesOf });
  const runs = Option.getOrNull(AsyncResult.value(ran));
  return {
    view: Option.getOrNull(AsyncResult.value(status)),
    canSet: capabilities.moveCiSwitch,
    runs: !capabilities.whereRan ? null : runs === null ? ("unknown" as const) : new Map<string, RepoRuns>(runs.map((each) => [each.repo, each])),
    // The row shows the move from the switch's own answer, without asking again.
    setRunner: (repo: string, variable: RunnerVariable, label: string | null) => runtime.run(environmentId, (client) => client["moveCi.setRunner"]({ repo, variable, label })).then(write),
  };
}
