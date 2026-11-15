import { useRpcQuery } from "./useRpcQuery.ts";

// Each harness the server can run turns on, and the models a turn may pick on it.
export function useHarnesses() {
  const harnesses = useRpcQuery(["threads.harnesses"], (client) => client["threads.harnesses"]());
  return harnesses.data ?? [];
}
