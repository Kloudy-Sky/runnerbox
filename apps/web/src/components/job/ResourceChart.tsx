import { useLayoutEffect, useRef, useState } from "react";
import { curvePath, smoothCurve } from "../../lib/curve.ts";
import { formatDuration } from "../../lib/format.ts";
import { observeResize } from "../../lib/observeResize.ts";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 260;
const PLOT_TOP = 8;

export type ChartPoint = { readonly offsetMs: number; readonly value: number };

type Props = {
  readonly label: string;
  readonly points: readonly ChartPoint[];
  readonly durationMs: number;
  readonly max: number;
  readonly ticks: readonly number[];
  // A dashed line at the kind's limit, labelled in text colour.
  readonly limit: { readonly value: number; readonly label: string } | null;
  // The step the sentence names, shaded, with where it starts under the axis.
  readonly mark: { readonly fromMs: number; readonly toMs: number; readonly label: string } | null;
  readonly format: (value: number) => string;
  // The tooltip's heading for a reading, such as "2m 10s in, Test" or a date.
  readonly describe: (offsetMs: number) => string;
  // Under the axis's two ends. A job's run starts at "0s" and ends at its length.
  readonly edges?: readonly [string, string];
};

// One series over one job, drawn the T3 Code way (see THIRD_PARTY_NOTICES.md): a monotone curve
// over a faint fill, recessive grid, and on hover a crosshair at the nearest reading with a tooltip
// that follows the pointer and stays inside the plot. One series, one colour.
export function ResourceChart({ label, points, durationMs, max, ticks, limit, mark, format, describe, edges = ["0s", formatDuration(durationMs)] }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const x = (offsetMs: number) => (durationMs <= 0 ? 0 : (Math.min(offsetMs, durationMs) / durationMs) * VIEW_WIDTH);
  const y = (value: number) => (max <= 0 ? VIEW_HEIGHT : VIEW_HEIGHT - (Math.min(value, max) / max) * (VIEW_HEIGHT - PLOT_TOP));
  const line = curvePath(smoothCurve(points.map((point) => ({ x: x(point.offsetMs), y: y(point.value) }))));
  const area = line === "" ? "" : `${line} L${x(points.at(-1)!.offsetMs)},${VIEW_HEIGHT} L${x(points[0]!.offsetMs)},${VIEW_HEIGHT} Z`;

  // Flips to the pointer's other side, then clamps, so the tooltip never leaves the plot.
  const place = () => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const at = pointer.current;
    if (!plot || !tooltip || !at) return;
    const gap = 12;
    const left = at.x + gap + tooltip.offsetWidth <= plot.clientWidth ? at.x + gap : at.x - gap - tooltip.offsetWidth;
    const top = at.y + gap + tooltip.offsetHeight <= plot.clientHeight ? at.y + gap : at.y - gap - tooltip.offsetHeight;
    plot.style.setProperty("--chart-tooltip-left", `${Math.min(Math.max(0, left), Math.max(0, plot.clientWidth - tooltip.offsetWidth))}px`);
    plot.style.setProperty("--chart-tooltip-top", `${Math.min(Math.max(0, top), Math.max(0, plot.clientHeight - tooltip.offsetHeight))}px`);
  };

  // Positions the tooltip through CSS variables before paint, and again when either box resizes.
  useLayoutEffect(() => {
    if (hover === null) return;
    place();
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    if (!plot || !tooltip) return;
    return observeResize([plot, tooltip], place);
  }, [hover, place]);

  const move = (event: React.MouseEvent<HTMLDivElement>) => {
    const plot = plotRef.current;
    if (!plot || points.length === 0) return;
    const bounds = plot.getBoundingClientRect();
    if (bounds.width === 0) return;
    const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
    pointer.current = { x: localX, y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)) };
    const at = (localX / bounds.width) * durationMs;
    const nearest = points.reduce((best, point, index) => (Math.abs(point.offsetMs - at) < Math.abs(points[best]!.offsetMs - at) ? index : best), 0);
    place();
    setHover(nearest);
  };

  const hovered = hover === null ? undefined : points[hover];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="relative h-36 w-10 shrink-0">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground tabular-nums" style={{ top: `${(y(tick) / VIEW_HEIGHT) * 100}%` }}>
              {tick === 0 ? "0" : format(tick)}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          className="relative h-36 min-w-0 flex-1"
          onMouseMove={move}
          onMouseLeave={() => {
            pointer.current = null;
            setHover(null);
          }}
        >
          <svg className="h-full w-full" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
            {mark ? <rect x={x(mark.fromMs)} y={0} width={Math.max(0, x(mark.toMs) - x(mark.fromMs))} height={VIEW_HEIGHT} className="fill-foreground/5" /> : null}
            {ticks.map((tick) => (
              <line key={tick} x1={0} x2={VIEW_WIDTH} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeWidth={1} className="text-border" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill="var(--color-info)" fillOpacity={0.12} />
            <path d={line} fill="none" stroke="var(--color-info)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {limit ? (
              <line x1={0} x2={VIEW_WIDTH} y1={y(limit.value)} y2={y(limit.value)} stroke="currentColor" strokeWidth={1} strokeDasharray="4 4" className="text-destructive" vectorEffect="non-scaling-stroke" />
            ) : null}
            {hovered ? (
              <line x1={x(hovered.offsetMs)} x2={x(hovered.offsetMs)} y1={PLOT_TOP} y2={VIEW_HEIGHT} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" vectorEffect="non-scaling-stroke" />
            ) : null}
          </svg>
          {limit ? (
            <span className="absolute right-0 -translate-y-full text-3xs text-muted-foreground" style={{ top: `${(y(limit.value) / VIEW_HEIGHT) * 100}%` }}>
              {limit.label}
            </span>
          ) : null}
          {hovered ? (
            <div
              ref={tooltipRef}
              className="surface-glass pointer-events-none absolute z-10 min-w-28 max-w-full rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg"
              style={{ left: "var(--chart-tooltip-left, 0px)", top: "var(--chart-tooltip-top, 0px)" }}
            >
              <div className="mb-1 text-muted-foreground">{describe(hovered.offsetMs)}</div>
              <div className="text-foreground tabular-nums">{format(hovered.value)}</div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="relative h-4 pl-12 text-3xs text-muted-foreground">
        <span className="absolute left-12">{edges[0]}</span>
        {mark && x(mark.fromMs) > VIEW_WIDTH * 0.12 && x(mark.fromMs) < VIEW_WIDTH * 0.8 ? (
          <span className="absolute" style={{ left: `calc(3rem + (100% - 3rem) * ${x(mark.fromMs) / VIEW_WIDTH})` }}>
            {mark.label}
          </span>
        ) : null}
        <span className="absolute right-0">{edges[1]}</span>
      </div>
    </div>
  );
}
