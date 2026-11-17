import { formatDuration } from "../../lib/format.ts";

const HOUR_MS = 60 * 60_000;

// Long stretches in whole hours, "124h", and short ones to the second.
export const hours = (ms: number) => (ms >= 10 * HOUR_MS ? `${Math.round(ms / HOUR_MS).toLocaleString()}h` : formatDuration(ms));

export const rangeWords = (days: number) => (days === 1 ? "the last day" : `the last ${days} days`);
