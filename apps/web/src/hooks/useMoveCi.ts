import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// Where each job on the environment's installed repositories picks its runner, and the patch that
// moves the rest. Asked again every minute, so a row updates soon after its patch is committed;
// the server asks GitHub no more often than that.
export function useMoveCi() {
  const { moveCi: available } = useServerCapabilities();
  const status = useRpcQuery(["moveCi"], (client) => client["moveCi.status"](), { enabled: available, refetchEvery: 60_000 });
  return status.data ?? null;
}
