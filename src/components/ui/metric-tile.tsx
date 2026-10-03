import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Metric Tile.
 *
 * A stat card: a label, a money value (mono), a short descriptor, and an
 * optional meta line. There is no "not charged" badge variant here — when a
 * tile is reporting an uncharged amount it is still just an amount with a call count, recoloured via the
 * `teal` tone (background/border/label/value), never a shield, tick or pill.
 *
 * The design layers two shadows (`$shadow-hair` at offset(0,1)/blur2 under a
 * second at offset(0,2)/blur6/spread-1) — the `shadow-soft` utility now
 * bakes both layers in one class, so that's what's applied here.
 *
 * The value is the largest number the product shows: 32px mono at 600 with
 * -0.5 tracking, which is `text-mono-2xl`. It bakes the weight, so no
 * font-semibold on top.
 */
const metricTileVariants = cva(
  "flex w-full flex-col gap-2 rounded-lg border p-5 shadow-soft",
  {
    variants: {
      tone: {
        default: "border-01 bg-01",
        teal: "border-teal-20 bg-teal-10",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  }
);

const metaToneClasses = {
  default: "text-03",
  warning: "text-warning-600",
} as const;

export interface MetricTileProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof metricTileVariants> {
  /** Small heading above the value, e.g. "Balance", "Today". */
  label: string;
  /** The money figure. Always rendered in the mono scale, never the sans one. */
  value: string;
  /** Short descriptor under the value, e.g. "available", "1,412 calls". */
  sub: string;
  /** Optional bottom line, e.g. "$0.06 held · 4 in flight". */
  meta?: string;
  /**
   * Recolours `meta`. Only "default" and "warning" are evidenced by the
   * design (the "Today" tile's "▲ 38% vs yesterday" trend line) — there is no success/danger trend example to derive from.
   */
  metaTone?: keyof typeof metaToneClasses;
}

const MetricTile = React.forwardRef<HTMLDivElement, MetricTileProps>(
  (
    { className, tone = "default", label, value, sub, meta, metaTone = "default", ...props },
    ref
  ) => {
    const isTeal = tone === "teal";

    return (
      <div ref={ref} className={cn(metricTileVariants({ tone }), className)} {...props}>
        <p className={cn("text-label-13", isTeal ? "text-teal-600" : "text-02")}>{label}</p>
        <p
          className={cn(
            "text-mono-2xl font-mono",
            isTeal ? "text-teal-600" : "text-01"
          )}
        >
          {value}
        </p>
        <p className="text-body-13 text-02">{sub}</p>
        {meta ? <p className={cn("text-body-13", metaToneClasses[metaTone])}>{meta}</p> : null}
      </div>
    );
  }
);
MetricTile.displayName = "MetricTile";

export { MetricTile, metricTileVariants };
