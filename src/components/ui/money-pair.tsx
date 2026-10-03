import * as React from "react";

import { cn } from "@/utils";

/**
 * Money Pair.
 *
 * This is the component that enforces "always render the counterfactual":
 * listed price and what was actually paid are two rows that always both
 * render, even when the values are equal. `listedValue` and `paidValue` are
 * required props for exactly that reason — there is no prop shape that lets
 * a caller render only one of them, and deliberately no "compact" or
 * single-value mode.
 *
 * The "Not charged" row is a delta rendered on top of
 * the pair, not a substitute for it. It is itself a label + an amount —
 * never a badge, shield or tick — per "not charged is never a badge".
 *
 * The design's first two rows bind `stroke: $border-02` but no
 * `strokeWidth`, which renders as no visible rule (confirmed against the
 * screenshot: no divider between "Listed price" and "You paid"). Only the
 * third row sets an explicit `strokeWidth: { top: 1 }`, so only that row
 * gets a top border here.
 *
 * All three rows' values are 13px/600 mono in the design (not just the
 * emphasized "Not charged" row) — `text-mono-13` bakes 400, so
 * `font-semibold` is layered on every value per the corrected token
 * contract (weight may be overridden; size and line-height may not).
 */
export interface MoneyPairProps extends React.HTMLAttributes<HTMLDivElement> {
  listedLabel?: string;
  listedValue: string;
  paidLabel?: string;
  paidValue: string;
  notChargedLabel?: string;
  /** When provided, renders the third "Not charged" row (the listed/paid delta). */
  notChargedValue?: string;
}

interface RowProps {
  label: string;
  value: string;
  emphasize?: boolean;
  className?: string;
}

function Row({ label, value, emphasize, className }: RowProps) {
  return (
    <div className={cn("flex w-full items-center justify-between gap-4", className)}>
      <span className={emphasize ? "text-label-13 text-teal-600" : "text-body-13 text-02"}>
        {label}
      </span>
      <span
        className={cn(
          "text-mono-13 font-mono font-semibold",
          emphasize ? "text-teal-600" : "text-01"
        )}
      >
        {value}
      </span>
    </div>
  );
}

const MoneyPair = React.forwardRef<HTMLDivElement, MoneyPairProps>(
  (
    {
      className,
      listedLabel = "Listed price",
      listedValue,
      paidLabel = "You paid",
      paidValue,
      notChargedLabel = "Not charged",
      notChargedValue,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex w-full flex-col gap-2 rounded-lg border border-01 bg-01 p-5 shadow-hair",
          className
        )}
        {...props}
      >
        <Row label={listedLabel} value={listedValue} />
        <Row label={paidLabel} value={paidValue} />
        {notChargedValue ? (
          <Row
            label={notChargedLabel}
            value={notChargedValue}
            emphasize
            className="border-t border-02 pt-2"
          />
        ) : null}
      </div>
    );
  }
);
MoneyPair.displayName = "MoneyPair";

export { MoneyPair };
