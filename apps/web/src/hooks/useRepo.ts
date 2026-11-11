import { useSearch } from "@tanstack/react-router";
import { parseSearch } from "../lib/search.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

// The repo a per-repo view shows: the one in the URL, or the first with a job log.
export function useRepo() {
  const { repo } = parseSearch(useSearch({ strict: false }));
  const repos = useRpcQuery(["repos"], (client) => client["history.repos"]());
  const list = repos.data ?? [];
  return { repo: repo && list.includes(repo) ? repo : list[0], repos: list, loaded: repos.isSuccess };
}
