import * as React from "react";

import { cn } from "@/utils";

/**
 * Donut.
 *
 * Hand-rolled inline SVG ring — no chart library is installed. Colour is
 * fully data-driven: each slice takes a `colorVar`, a CSS custom-property
 * reference such as `"var(--chart-1)"`.
 *
 * The design's own instance of this component does NOT use the chart-1..6
 * series ramp — it's a verdict breakdown (Passed/Failed/Degraded/Not
 * sampled) coloured `$success-500` / `$danger-500` / `$warning-500` /
 * `$bg-04`, because those carry fixed semantic meaning here, not arbitrary
 * category colour. `$bg-04` is also why the API takes a raw CSS var instead
 * of a Tailwind class name: `bg-04` only exists as a `backgroundColor`
 * utility, not a `fill-*` one (it isn't declared under `theme.colors`), so
 * there is no single Tailwind class that works for every token this ring
 * needs to accept. A generic chart-1..6 usage is equally supported — just
 * pass `"var(--chart-1)"` etc. as the slice colours.
 *
 * The centre figure is 26px mono at 600 with -0.5 tracking: `text-mono-xl`.
 */
export interface DonutSlice {
  label: string;
  value: number;
  /** Defaults to `String(value)`. Use for display-only values like "—". */
  displayValue?: string;
  /** CSS var reference, e.g. "var(--chart-1)" or "var(--success-500)". */
  colorVar: string;
}

export interface DonutProps extends React.HTMLAttributes<HTMLDivElement> {
  slices: DonutSlice[];
  /** e.g. "96.6%". */
  centerValue: string;
  /** e.g. "pass rate". */
  centerLabel: string;
  /** Diameter in px. Defaults to 180, matching the design node. */
  size?: number;
}

const Donut = React.forwardRef<HTMLDivElement, DonutProps>(
  ({ className, slices, centerValue, centerLabel, size = 180, ...props }, ref) => {
    const titleId = React.useId();
    const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);

    // innerRadius: 0.68 in the design — the hole is 68% of the outer
    // radius, so the ring band is the outer 32%. Reproduced here as a
    // stroked circle: strokeWidth = band thickness, centre-line radius set
    // so the stroke's outer edge lands on the outer radius.
    const outerR = size / 2 - 2;
    const strokeWidth = outerR * 0.32;
    const centerR = outerR - strokeWidth / 2;
    const circumference = 2 * Math.PI * centerR;
    const c = size / 2;

    let cumulative = 0;
    const arcs =
      total > 0
        ? slices
            .filter((slice) => slice.value > 0)
            .map((slice) => {
              const length = (slice.value / total) * circumference;
              const dasharray = `${length} ${circumference - length}`;
              const dashoffset = -cumulative;
              cumulative += length;
              return { ...slice, dasharray, dashoffset };
            })
        : [];

    const summary = `${centerLabel}: ${centerValue}. ${slices
      .map((slice) => `${slice.label} ${slice.displayValue ?? slice.value}`)
      .join(", ")}.`;

    return (
      <div
        ref={ref}
        className={cn("flex w-full flex-col items-center gap-4", className)}
        {...props}
      >
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={titleId}>
            <title id={titleId}>{summary}</title>
            {total === 0 ? (
              <circle
                cx={c}
                cy={c}
                r={centerR}
                fill="none"
                stroke="var(--bg-04)"
                strokeWidth={strokeWidth}
              />
            ) : (
              <g transform={`rotate(-90 ${c} ${c})`}>
                {arcs.map((arc) => (
                  <circle
                    key={arc.label}
                    cx={c}
                    cy={c}
                    r={centerR}
                    fill="none"
                    stroke={arc.colorVar}
                    strokeWidth={strokeWidth}
                    strokeDasharray={arc.dasharray}
                    strokeDashoffset={arc.dashoffset}
                  />
                ))}
              </g>
            )}
          </svg>
          {/* Real text nodes overlaid on the ring, matching the design's
              absolutely-positioned "Center"/"Center sub" text layers — this
              is what makes the summary readable without relying on the SVG. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
            <span className="text-mono-xl font-mono text-01">{centerValue}</span>
            <span className="text-body-xs text-03">{centerLabel}</span>
          </div>
        </div>

        <ul className="flex w-full flex-col gap-2" aria-label={`${centerLabel} breakdown`}>
          {slices.map((slice) => (
            <li key={slice.label} className="flex w-full items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: slice.colorVar }}
              />
              <span className="flex-1 text-body-13 text-02">{slice.label}</span>
              <span className="text-mono-13 font-mono text-01">
                {slice.displayValue ?? slice.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
);
Donut.displayName = "Donut";

export { Donut };
