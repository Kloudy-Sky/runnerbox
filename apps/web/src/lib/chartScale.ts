// Gridline values for a chart whose data reaches `max`: zero and about four clean steps of 1, 2 or
// 5 times a power of ten, the last at or above `max`. Steps are whole, since the charts count jobs
// and reviews, and time in whole units.
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = Math.max(1, max / count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((multiple) => multiple * power >= rough) ?? 10) * power;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, index) => index * step);
}

// The unit a duration axis counts in, picked from its longest value, so ticks read "10s" or "4m".
export function durationUnit(maxMs: number) {
  if (maxMs >= 2 * 3_600_000) return { ms: 3_600_000, suffix: "h" };
  if (maxMs >= 2 * 60_000) return { ms: 60_000, suffix: "m" };
  return { ms: 1_000, suffix: "s" };
}

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const month = (day: string) => date(day).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }).toUpperCase();

// Under each of a day chart's columns: the day of the month, every few days so at most eight show,
// and the month under the first shown and wherever a new one starts. `days` are "2026-11-17" dates.
export function dayTicks(days: ReadonlyArray<string>) {
  const every = Math.ceil(days.length / 8);
  // Counted from the newest, so today always has its label.
  const shown = (index: number) => (days.length - 1 - index) % every === 0;
  const first = days.findIndex((_, index) => shown(index));
  return days.map((day, index) => {
    if (!shown(index)) return null;
    const earlier = days[index - every];
    return { day: String(date(day).getUTCDate()), month: index === first || (earlier !== undefined && earlier.slice(0, 7) !== day.slice(0, 7)) ? month(day) : null };
  });
}

// "Nov 17", for a hover title.
export const dayName = (day: string) => date(day).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
