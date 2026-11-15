import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// One job attempt's steps, memory and CPU, from a server new enough to have them. An older server
// never gets asked, so its run pages stay as they were. Nothing is asked until the job is known.
export function useJobResources(job: { readonly repo: string; readonly jobId: number } | undefined) {
  const { jobResources } = useServerCapabilities();
  return useRpcQuery(["jobResources", job?.repo, job?.jobId], (client) => client["history.jobResources"]({ repo: job!.repo, jobId: job!.jobId }), {
    enabled: jobResources && job !== undefined,
  });
}
