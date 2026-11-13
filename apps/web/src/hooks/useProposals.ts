import type { ApplyWhen } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

// Every proposal on the environment, and the owner's decisions on them. Asked again every 15
// seconds, since `up` applies an approved change on its own time.
export function useProposals() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const queryClient = useQueryClient();
  const list = useRpcQuery(["proposals"], (client) => client["proposals.list"](), 15_000);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [environmentId, "proposals"] });
  return {
    proposals: list.data?.proposals ?? [],
    canApprove: list.data?.canApprove ?? false,
    approve: (id: string, hash: string, when: ApplyWhen) => runtime.run(environmentId, (client) => client["proposals.approve"]({ id, hash, when })).finally(refresh),
    decline: (id: string) => runtime.run(environmentId, (client) => client["proposals.decline"]({ id })).finally(refresh),
    revert: (id: string) => runtime.run(environmentId, (client) => client["proposals.revert"]({ id })).finally(refresh),
  };
}
