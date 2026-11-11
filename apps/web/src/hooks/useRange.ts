import { useSearch } from "@tanstack/react-router";
import { RANGES } from "../lib/range.ts";
import { parseSearch } from "../lib/search.ts";

export function useRange() {
  const { range = "7d" } = parseSearch(useSearch({ strict: false }));
  return { range, days: RANGES[range] };
}
