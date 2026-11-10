import { isRange, type Range } from "./range.ts";

// The URL's search params: the time range and the repo. The router validates with this, and hooks
// parse with it too, since the router's own inferred types don't survive TypeScript 7's cycle check.
export type RootSearch = { range?: Range; repo?: string };

export const parseSearch = (search: Record<string, unknown>): RootSearch => ({
  ...(isRange(search.range) ? { range: search.range } : {}),
  ...(typeof search.repo === "string" ? { repo: search.repo } : {}),
});
