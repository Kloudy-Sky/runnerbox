import { useRange } from "./useRange.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

export function useInbox() {
  const { days } = useRange();
  return useRpcQuery(["inbox", days], (client) => client["inbox.list"]({ days }));
}
