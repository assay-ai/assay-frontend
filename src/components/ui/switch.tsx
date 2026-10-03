import * as React from "react";

import { cn } from "@/utils";

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Text rendered next to the track — caller-supplied (e.g. "On" / "Off"). */
  label?: React.ReactNode;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
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
          type="checkbox"
          role="switch"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-04 transition-colors",
            "peer-checked:bg-success-500",
            "peer-checked:[&>span]:translate-x-4",
            "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-500"
          )}
        >
          <span className="h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform" />
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
Switch.displayName = "Switch";

export { Switch };
