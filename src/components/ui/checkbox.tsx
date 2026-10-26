import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /**
   * Text rendered next to the box. The design shows caller-supplied data
   * here (a percentage), not fixed vocabulary — pass whatever the caller
   * needs.
   */
  label?: React.ReactNode;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, disabled, ...props }, ref) => {
    return (
      <label
        className={cn(
          "group/choice relative inline-flex items-center gap-[9px]",
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
          className
        )}
      >
        {/*
          The real input lies, invisible, right over the drawn box, so a click
          (or a test driver) on the control itself toggles it — not only a
          click on the label text. It used to be `sr-only`: a 1px clipped box
          at the label's corner, where a click landed outside the label.
        */}
        <span className="relative flex h-[17px] w-[17px] shrink-0">
          <input
            ref={ref}
            type="checkbox"
            disabled={disabled}
            className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-[inherit] appearance-none opacity-0"
            {...props}
          />
          <span
            aria-hidden="true"
            className={cn(
              "relative flex h-full w-full items-center justify-center rounded-sm",
              "border border-03 bg-01 transition-colors",
              "peer-checked:border-primary-500 peer-checked:bg-primary-400",
              "peer-checked:[&>svg]:opacity-100",
              "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-500"
            )}
          >
            <Check
              aria-hidden="true"
              strokeWidth={3}
              className="h-3 w-3 text-on-primary opacity-0 transition-opacity"
            />
          </span>
        </span>
        {label !== undefined && (
          <span className="text-body-sm text-02 group-has-[:checked]/choice:text-01">
            {label}
          </span>
        )}
      </label>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
