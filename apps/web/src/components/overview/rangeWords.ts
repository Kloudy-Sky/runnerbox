import type { Range } from "../../lib/range.ts";

// The range in Overview's words: what it's called in the filter, and the period before it that the
// totals compare against.
export const RANGE_WORDS = {
  "1d": { now: "Today", before: "yesterday" },
  "7d": { now: "This week", before: "last week" },
  "30d": { now: "This month", before: "last month" },
} as const satisfies Record<Range, { now: string; before: string }>;
