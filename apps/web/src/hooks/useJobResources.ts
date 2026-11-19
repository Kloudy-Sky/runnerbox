import { useAtomValue } from "@effect/atom-react";
import { answerOf } from "../lib/answer.ts";
import { jobResourcesAtom } from "../state/history.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// One job attempt's steps, memory and CPU, from a server new enough to have them. An older server
// never gets asked, so its run pages stay as they were. Nothing is asked until the job is known:
// until then it reads no machine.
export function useJobResources(job: { readonly repo: string; readonly jobId: number } | undefined) {
  const environmentId = useActiveEnvironment().environment?.environmentId ?? "";
  return answerOf(useAtomValue(jobResourcesAtom(job === undefined ? { environmentId: "", repo: "", jobId: 0 } : { environmentId, repo: job.repo, jobId: job.jobId })));
}
