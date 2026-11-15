// Time math over [start, end) spans in ms, for how much of a wait something else covered.

export type Span = { start: number; end: number };

// How long, inside `within`, at least `depth` of `spans` overlapped at once. Depth 1 is plain
// coverage; depth N is "all N slots were taken".
export function coveredMs(within: Span, spans: readonly Span[], depth = 1) {
  const edges = spans
    .flatMap(({ start, end }) => {
      const from = Math.max(start, within.start);
      const to = Math.min(end, within.end);
      return from < to ? [{ at: from, step: 1 }, { at: to, step: -1 }] : [];
    })
    // Ends before starts at the same instant, so back-to-back spans don't count as overlapping.
    .toSorted((a, b) => a.at - b.at || a.step - b.step);
  let open = 0;
  let since = 0;
  let total = 0;
  for (const { at, step } of edges) {
    if (open >= depth) total += at - since;
    open += step;
    since = at;
  }
  return total;
}

// The most spans open at one instant inside any of `within`.
export function peakOverlap(within: readonly Span[], spans: readonly Span[]) {
  // Each window's start is an edge of its own, for spans already open when it begins.
  const edges = [...spans.flatMap(({ start, end }) => [{ at: start, step: 1 }, { at: end, step: -1 }]), ...within.map(({ start }) => ({ at: start, step: 0 }))].toSorted(
    (a, b) => a.at - b.at || a.step - b.step,
  );
  const inside = (at: number) => within.some((window) => at >= window.start && at < window.end);
  let open = 0;
  let peak = 0;
  for (const { at, step } of edges) {
    open += step;
    if (inside(at)) peak = Math.max(peak, open);
  }
  return peak;
}
