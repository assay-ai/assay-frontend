import * as React from "react";

import { cn } from "@/utils";

/**
 * A small trend line (no axes), for a headline figure: "spent this week, and
 * how it moved day by day". Values are proportions only; the figure next to
 * it carries the real amount. Uses `currentColor`, so the caller sets the tone
 * with a text colour token and it follows light and dark mode.
 */
export function Sparkline({
  values,
  label,
  className,
  width = 120,
  height = 32,
}: {
  values: readonly number[];
  /** Spoken summary, e.g. "Daily spend over the last 7 days, rising". */
  label: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1]!;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <path d={area} fill="currentColor" opacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" />
    </svg>
  );
}
