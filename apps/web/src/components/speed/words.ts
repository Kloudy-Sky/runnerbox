import { formatDuration } from "../../lib/format.ts";

const HOUR_MS = 60 * 60_000;

// Long stretches in whole hours, "124h", and short ones to the second.
export const hours = (ms: number) => (ms >= 10 * HOUR_MS ? `${Math.round(ms / HOUR_MS).toLocaleString()}h` : formatDuration(ms));

export const rangeWords = (days: number) => (days === 1 ? "the last day" : `the last ${days} days`);

// Dollars as people say them: whole above $10, cents below.
export const dollars = (usd: number) => `$${usd >= 10 ? Math.round(usd).toLocaleString() : usd.toFixed(2)}`;

// Review spending is small and per item, so it keeps its cents: "$16.40", or "under $0.01" for a
// cheap review rather than a "$0.00" that reads as free.
export const cents = (usd: number) => (usd > 0 && usd < 0.005 ? "under $0.01" : `$${usd.toFixed(2)}`);
