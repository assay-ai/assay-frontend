import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Meter.
 *
 * A labelled progress bar: label + amount on top, a track/fill bar, and a
 * note line underneath. Fill colour is data-driven — the canonical instance
 * binds `$warning-500`, while sibling instances rebind it to
 * `$primary-500` ("Meter Month") and `$teal-500` ("Meter Quota"), so all three are exposed as a `tone` variant.
 *
 * The design's own "Fill"/"Rest" split renders at pixel widths that don't
 * match the instance copy (e.g. the canonical instance draws ~91% fill next
 * to "82% used" text) — the split is illustrative, not literally bound to
 * the copy. Implemented here as a standard `percent`-driven fill instead.
 */
const meterFillVariants = cva("h-2 rounded-full transition-[width]", {
  variants: {
    tone: {
      warning: "bg-warning-500",
      primary: "bg-primary-500",
      teal: "bg-teal-500",
    },
  },
  defaultVariants: {
    tone: "warning",
  },
});

export interface MeterProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof meterFillVariants> {
  /** e.g. "Per day", "Free quota". */
  label: string;
  /** Pre-formatted "used of total" text, e.g. "$8.20 of $10.00". */
  amount: string;
  /** 0–100. Drives the fill width; clamped to range. */
  percent: number;
  /** e.g. "82% used · resets 00:00 UTC". */
  note: string;
}

const Meter = React.forwardRef<HTMLDivElement, MeterProps>(
  ({ className, label, amount, percent, note, tone = "warning", ...props }, ref) => {
    const clamped = Math.min(100, Math.max(0, percent));

    return (
      <div ref={ref} className={cn("flex w-full flex-col gap-2", className)} {...props}>
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-label-13 text-01">{label}</span>
          <span className="text-mono-13 font-mono text-02">{amount}</span>
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuenow={Math.round(clamped)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-03"
        >
          <div className={meterFillVariants({ tone })} style={{ width: `${clamped}%` }} />
        </div>
        <p className="text-body-xs text-03">{note}</p>
      </div>
    );
  }
);
Meter.displayName = "Meter";

export { Meter, meterFillVariants };
