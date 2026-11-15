import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// One job attempt's steps, memory and CPU, from a server new enough to have them. An older server
// never gets asked, so its run pages stay as they were.
export function useJobResources(repo: string, jobId: number) {
  const { jobResources } = useServerCapabilities();
  return useRpcQuery(["jobResources", repo, jobId], (client) => client["history.jobResources"]({ repo, jobId }), { enabled: jobResources });
}
