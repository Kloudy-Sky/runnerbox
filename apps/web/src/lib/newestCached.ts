import type { QueryClient, QueryKey } from "@tanstack/react-query";

// The newest answer cached under keys that start with `prefix`. `useQueries` makes a new observer
// whenever a key changes, so React Query's own `keepPreviousData` has nothing to keep there, and a
// view would empty out while the new key loads; the cache still has the last answer.
export const newestCached = <A,>(client: QueryClient, prefix: QueryKey) =>
  client
    .getQueriesData<A>({ queryKey: prefix })
    .filter((entry): entry is [QueryKey, A] => entry[1] !== undefined)
    .toSorted(([a], [b]) => (client.getQueryState(b)?.dataUpdatedAt ?? 0) - (client.getQueryState(a)?.dataUpdatedAt ?? 0))[0]?.[1];
