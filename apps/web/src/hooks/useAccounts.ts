import { useQueryClient } from "@tanstack/react-query";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

// The accounts agent turns can run as, and a way to refresh them after a change.
export function useAccounts() {
  const { environment } = useActiveEnvironment();
  const queryClient = useQueryClient();
  const accounts = useRpcQuery(["accounts"], (client) => client["accounts.list"]());
  return {
    accounts: accounts.data ?? [],
    loaded: accounts.isSuccess,
    error: accounts.error,
    refresh: () => queryClient.invalidateQueries({ queryKey: [environment?.environmentId ?? "", "accounts"] }),
  };
}
