import { useAtomValue } from "@effect/atom-react";
import { useSearch } from "@tanstack/react-router";
import { answerOf } from "../lib/answer.ts";
import { parseSearch } from "../lib/search.ts";
import { reposAtom } from "../state/history.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// The repo a per-repo view shows: the one in the URL, or the first with a job log.
export function useRepo() {
  const { repo } = parseSearch(useSearch({ strict: false }));
  const repos = answerOf(useAtomValue(reposAtom(useActiveEnvironment().environment?.environmentId ?? "")));
  const list = repos.data ?? [];
  return { repo: repo && list.includes(repo) ? repo : list[0], repos: list, loaded: repos.isSuccess };
}
