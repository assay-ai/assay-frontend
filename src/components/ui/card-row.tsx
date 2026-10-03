import * as React from "react";

import { ChevronRight } from "@/components/icons";
import { cn } from "@/utils";

/**
 * Card Row: the mobile-width stand-in for a table row (the design's
 * breakpoint rule: "Row becomes a card: name on line 1, figures as
 * label/value pairs below"). It renders the counterfactual per rule 1 —
 * listed and charged are always both present as their own figure, never
 * folded into one number — and a third figure for the amount not charged,
 * which per rule 2 is a plain figure, not a badge.
 */

export interface CardRowFigure {
  label: string;
  value: string;
  /** Renders the value in the teal-600 accent, as the design does for "Not charged". */
  tone?: "default" | "teal";
}

export interface CardRowProps {
  /** Mono, bold — the tool/binding name, e.g. `scrape_url`. */
  name: string;
  /** Mono, e.g. `14,760 calls`. */
  callsLabel: string;
  /** Always render listed + charged (+ not charged); never collapse to one number. */
  figures: CardRowFigure[];
  /** Mono meta line, e.g. `fail 2.4% · p95 2.4s · $0.0025 each`. */
  meta: string;
  onClick?: () => void;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

const CardRow = React.forwardRef<HTMLButtonElement | HTMLDivElement, CardRowProps>(
  ({ className, name, callsLabel, figures, meta, onClick, ...props }, ref) => {
    const content = (
      <>
        <div className="flex w-full items-center gap-2.5">
          <p className="min-w-0 flex-1 truncate text-mono-sm font-mono font-semibold text-01">{name}</p>
          <p className="shrink-0 text-mono-12 font-mono text-03">{callsLabel}</p>
        </div>
        <div className="flex w-full gap-3">
          {figures.map((figure) => (
            <div key={figure.label} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <p className="truncate text-body-xs text-03">{figure.label}</p>
              <p
                className={cn(
                  "truncate text-mono-md font-mono font-semibold",
                  figure.tone === "teal" ? "text-teal-600" : "text-01"
                )}
              >
                {figure.value}
              </p>
            </div>
          ))}
        </div>
        <div className="flex w-full items-center justify-between gap-2.5 border-t border-01 pt-2.5">
          <p className="min-w-0 flex-1 truncate text-mono-xs font-mono text-03">{meta}</p>
          <ChevronRight className="h-4 w-4 shrink-0 text-03" />
        </div>
      </>
    );

    const sharedClassName = cn(
      "flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-4 text-left",
      className
    );

    if (onClick) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          className={cn(
            sharedClassName,
            "transition-colors hover:bg-02 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          )}
          {...props}
        >
          {content}
        </button>
      );
    }

    return (
      <div ref={ref as React.Ref<HTMLDivElement>} className={sharedClassName}>
        {content}
      </div>
    );
  }
);
CardRow.displayName = "CardRow";

export { CardRow };
