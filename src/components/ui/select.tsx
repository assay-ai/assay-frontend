import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Design: "Select", from the design's "Field Bench".
 *
 * Only one instance is drawn (label "Destination", value
 * "7xKX…vault  (added 2026-07-02)", a `chevron-down` icon, hint
 * "3 allowlisted destinations"). No open/popup state is drawn anywhere in the
 * design — there is nothing to read a custom listbox's popup styling off of.
 * That, plus `@radix-ui/react-select` not being installed, is why this is a
 * native `<select>` styled to match the closed-box look, not a hand-rolled
 * listbox: a native control gives correct keyboard nav, screen-reader
 * semantics and OS-native option rendering for free, and there is no design
 * detail for a custom popup to reproduce or diverge from.
 *
 * Focus and disabled are reproduced with `focus-within`/`has-*` on the
 * wrapper rather than a prop — neither is drawn on this bench either; the
 * look (primary-500 ring on focus, bg-03/text-03 on disabled) is carried over
 * from Field and the Button bench's `Button Disabled` respectively.
 */
export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Field label, shown above the box. */
  label: React.ReactNode;
  /** Helper text shown below the box. */
  hint?: React.ReactNode;
  /** Class name applied to the outer `<label>` wrapper. */
  wrapperClassName?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, label, hint, id, children, ...props }, ref) => {
    return (
      <label className={cn("flex w-full flex-col gap-1.5", wrapperClassName)}>
        <span className="text-label-13 text-01">{label}</span>
        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2.5",
            "has-[:focus]:border-[1.5px] has-[:focus]:border-primary-500",
            "has-[:disabled]:border-transparent has-[:disabled]:bg-03"
          )}
        >
          <select
            ref={ref}
            id={id}
            className={cn(
              "w-full min-w-0 flex-1 appearance-none bg-transparent font-mono text-mono-13 text-01 outline-none disabled:cursor-not-allowed disabled:text-03",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="size-[15px] shrink-0 text-03"
          />
        </div>
        {hint ? <p className="text-body-xs text-03">{hint}</p> : null}
      </label>
    );
  }
);
Select.displayName = "Select";

export { Select };
