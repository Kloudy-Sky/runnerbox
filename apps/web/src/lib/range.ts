export const RANGES = { "1d": 1, "7d": 7, "30d": 30 } as const;
export type Range = keyof typeof RANGES;
export const isRange = (value: unknown): value is Range => typeof value === "string" && value in RANGES;
