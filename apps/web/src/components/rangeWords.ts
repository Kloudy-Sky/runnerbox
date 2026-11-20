import type { Range } from "../lib/range.ts";

// The range in words: what the range menu calls it, and the period before it that Overview's totals
// compare against.
export const RANGE_WORDS = {
  "1d": { now: "Today", before: "yesterday" },
  "7d": { now: "This week", before: "last week" },
  "30d": { now: "This month", before: "last month" },
} as const satisfies Record<Range, { now: string; before: string }>;
