import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { observeResize } from "../../lib/observeResize.ts";
import { CHART } from "./dayChart.ts";

// An SVG drawn at the width it's given rather than scaled, so its text stays the same size at any
// width. Nothing is drawn until the width is known.
export function DayChart({ label, children }: { label: string; children: (width: number) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Measuring the laid-out box is synchronizing with the DOM.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.clientWidth);
    return observeResize(element, ([entry]) => setWidth(entry?.contentRect.width ?? 0));
  }, []);
  return (
    <div ref={box} style={{ height: CHART.height }}>
      {width > 0 ? (
        <svg width={width} height={CHART.height} className="block" role="img" aria-label={label}>
          {children(width)}
        </svg>
      ) : null}
    </div>
  );
}
