import type { MoveCiView, RunnerVariable } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// Where each job on the environment's installed repositories picks its runner, the patch that
// moves the rest, and the switch that sets their runner variable. Asked again every minute, so a
// row updates soon after its patch is committed; the server asks GitHub no more often than that.
// `canSet` is false on a server older than the switch.
export function useMoveCi() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const { moveCi: available, moveCiSwitch: canSet } = useServerCapabilities();
  const queryClient = useQueryClient();
  const status = useRpcQuery(["moveCi"], (client) => client["moveCi.status"](), { enabled: available, refetchEvery: 60_000 });
  return {
    view: status.data ?? null,
    canSet,
    // Answers with the view as it now is, so the row shows the move without asking again.
    setRunner: (repo: string, variable: RunnerVariable, label: string | null) =>
      runtime.run(environmentId, (client) => client["moveCi.setRunner"]({ repo, variable, label })).then((view: MoveCiView) => void queryClient.setQueryData([environmentId, "moveCi"], view)),
  };
}
