// A small line of values, scaled to its own range. The last point is marked.
export function Sparkline({ values, height = 36 }: { values: readonly number[]; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const x = (index: number) => (index / (values.length - 1)) * 100;
  const y = (value: number) => height - 2 - ((value - min) / (max - min || 1)) * (height - 4);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
      <polyline points={points} fill="none" stroke="var(--color-info)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="1.6" fill="var(--color-destructive)" />
    </svg>
  );
}
