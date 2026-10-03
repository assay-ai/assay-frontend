import * as React from "react";

import { cn } from "@/utils";

/**
 * Window Gauge.
 *
 * A segmented progress bar for a COUNT INSIDE A WINDOW, not a percentage. The
 * design fills whole segments only — 218 of 400 lights 11 of 20 — because the
 * quantity being shown is "have we accumulated enough evidence yet", and a
 * partially lit segment would imply a precision the number does not have.
 *
 * The gauge is also a gate: below the threshold, something cannot happen, and
 * the hint says what. That is why `hint` sits next to a state chip rather than
 * being a tooltip.
 */

const SEGMENT_COUNT = 20;

export interface WindowGaugeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Current count within the window. */
  value: number;
  /** The window size the count is measured against. */
  max: number;
  /** Left-hand label, e.g. "verified calls". */
  label: React.ReactNode;
  /**
   * Chip shown under the track — the window's state. Render a Badge here.
   * Optional: a gauge with no gate attached simply omits it.
   */
  state?: React.ReactNode;
  /** Plain-language consequence, e.g. "below 400, no proposal can be issued". */
  hint?: React.ReactNode;
  /** Track colour for lit segments. Defaults to primary. */
  tone?: "primary" | "success" | "warning" | "danger";
}

const toneFill: Record<NonNullable<WindowGaugeProps["tone"]>, string> = {
  primary: "bg-primary-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
};

export function WindowGauge({
  value,
  max,
  label,
  state,
  hint,
  tone = "primary",
  className,
  ...props
}: WindowGaugeProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(value, safeMax));
  // Whole segments only, and never round a non-zero count down to nothing or a
  // short-of-target count up to full.
  const exact = (clamped / safeMax) * SEGMENT_COUNT;
  let lit = Math.round(exact);
  if (clamped > 0 && lit === 0) lit = 1;
  if (clamped < safeMax && lit === SEGMENT_COUNT) lit = SEGMENT_COUNT - 1;

  return (
    <div className={cn("flex w-full flex-col gap-2", className)} {...props}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-label-13 text-01">{label}</span>
        <span className="font-mono text-mono-13 font-semibold text-01">
          {clamped.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>

      <div
        className="flex h-[10px] w-full gap-[3px]"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuetext={`${clamped.toLocaleString()} of ${max.toLocaleString()}`}
      >
        {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn("h-full flex-1 rounded-[2px]", i < lit ? toneFill[tone] : "bg-03")}
          />
        ))}
      </div>

      {state || hint ? (
        <div className="flex items-center gap-2">
          {state}
          {hint ? <span className="text-body-xs text-03">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
