import * as React from "react";

import { cn } from "@/utils";

export interface RadioProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Text rendered next to the dot — caller-supplied, e.g. an option name. */
  label?: React.ReactNode;
}

const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  ({ className, label, disabled, ...props }, ref) => {
    return (
      <label
        className={cn(
          "inline-flex items-center gap-[9px]",
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
          className
        )}
      >
        <input
          ref={ref}
          type="radio"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full",
            "border border-03 bg-01 transition-colors",
            "peer-checked:border-[1.5px] peer-checked:border-primary-500",
            "peer-checked:[&>span]:opacity-100",
            "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-500"
          )}
        >
          <span className="h-2 w-2 rounded-full bg-primary-500 opacity-0 transition-opacity" />
        </span>
        {label !== undefined && (
          <span className="text-body-sm text-02 peer-checked:text-01">
            {label}
          </span>
        )}
      </label>
    );
  }
);
Radio.displayName = "Radio";

export { Radio };
