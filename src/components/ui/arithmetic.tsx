import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

const valueVariants = cva("w-[110px] shrink-0 text-right text-mono-13 font-mono font-semibold", {
  variants: {
    tone: {
      default: "text-01",
      success: "text-success-600",
      danger: "text-danger-600",
      muted: "text-02",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export type ArithmeticValueTone = NonNullable<VariantProps<typeof valueVariants>["tone"]>;

export interface ArithmeticRow {
  id?: string;
  /** Variable name, e.g. "verified_calls". */
  label: string;
  /** The derivation, e.g. "92 / 612 =". Omit for a row with no formula (a raw input). */
  expression?: string;
  /** The result, e.g. "15.03%" or "$10.27". */
  value: string;
  note?: string;
  valueTone?: ArithmeticValueTone;
}

export interface ArithmeticProps extends React.HTMLAttributes<HTMLDivElement> {
  rows: ArithmeticRow[];
}

/**
 * A calculation the user can audit: every row is variable, derivation and
 * result, right-aligned in mono so the numbers stack for comparison.
 * Alternating row backgrounds (not borders) separate the rows, matching the
 * design's zebra treatment.
 */
export const Arithmetic = React.forwardRef<HTMLDivElement, ArithmeticProps>(
  ({ rows, className, ...props }, ref) => (
    <div ref={ref} className={cn("flex w-full flex-col", className)} {...props}>
      {rows.map((row, index) => (
        <div
          key={row.id ?? `${row.label}-${index}`}
          className={cn(
            "flex w-full items-center gap-3.5 px-3 py-2",
            index % 2 === 1 ? "bg-02" : "bg-transparent"
          )}
        >
          <span className="sr-only">
            {row.label}
            {row.expression ? `, ${row.expression}` : ""} {row.value}
            {row.note ? ` — ${row.note}` : ""}
          </span>
          <span aria-hidden="true" className="w-[220px] shrink-0 text-mono-12 font-mono text-02">
            {row.label}
          </span>
          <span
            aria-hidden="true"
            className="w-[260px] shrink-0 text-right text-mono-12 font-mono text-03"
          >
            {row.expression}
          </span>
          <span aria-hidden="true" className={valueVariants({ tone: row.valueTone })}>
            {row.value}
          </span>
          {row.note ? (
            <span aria-hidden="true" className="min-w-0 flex-1 text-body-xs text-03">
              {row.note}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
);
Arithmetic.displayName = "Arithmetic";
