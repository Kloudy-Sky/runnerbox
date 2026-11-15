import { useRpcQuery } from "./useRpcQuery.ts";

// Each harness the server can run turns on, and the models a turn may pick on it. None from a
// server that can't list them.
export function useHarnesses(supported: boolean) {
  const harnesses = useRpcQuery(["threads.harnesses"], (client) => client["threads.harnesses"](), { enabled: supported });
  return supported ? (harnesses.data ?? []) : [];
}
