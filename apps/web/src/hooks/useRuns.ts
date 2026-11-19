import { useAtomValue } from "@effect/atom-react";
import { answerOf } from "../lib/answer.ts";
import { runsAtom } from "../state/history.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// A repository's runs over the last `days` on the active environment, the newest first, as All
// runs, a run's page, Speed and cost and the command palette share them.
export function useRuns(repo: string | undefined, days: number) {
  const environmentId = useActiveEnvironment().environment?.environmentId ?? "";
  return answerOf(useAtomValue(runsAtom({ environmentId, repo, days })));
}
