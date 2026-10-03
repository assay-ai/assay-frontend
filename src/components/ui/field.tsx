import * as React from "react";

import { cn } from "@/utils";

/**
 * Design: "Field", from the design's "Field Bench".
 *
 * The bench draws three instances of this component: default (label "Amount",
 * value "11.40", suffix "USDC", hint "Withdrawable $11.40"), focused (box
 * stroke swaps to `$primary-500` at 1.5px — reproduced below with
 * `focus-within`, no prop needed), and error (box stroke `$danger-500` at
 * 1.5px, hint recolored to `$danger-500`). Disabled is not drawn for this
 * component; the `disabled` styling below is inferred from the Button bench's
 * `Button Disabled` treatment (`bg-03`/`text-03`), not read off this bench.
 *
 * This replaces `input.tsx` — that file is retired by the parent once this
 * lands.
 */
export interface FieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Field label, shown above the box. */
  label: React.ReactNode;
  /** Trailing unit/suffix inside the box (e.g. a currency code). Recolors to danger with `error`. */
  suffix?: React.ReactNode;
  /** Helper text shown below the box. Replaced by `error` when set. */
  hint?: React.ReactNode;
  /** Error message. When set, the box and helper text switch to the error look. */
  error?: string;
  /** Class name applied to the outer `<label>` wrapper. */
  wrapperClassName?: string;
}

const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  (
    { className, wrapperClassName, label, suffix, hint, error, id, disabled, ...props },
    ref
  ) => {
    const hasError = Boolean(error);
    const helpText = error ?? hint;
    const describedById = id ? `${id}-hint` : undefined;

    return (
      <label className={cn("flex w-full flex-col gap-1.5", wrapperClassName)}>
        <span className="text-label-13 text-01">{label}</span>
        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2.5 focus-within:border-[1.5px] focus-within:border-primary-500",
            hasError && "border-[1.5px] border-danger-500 focus-within:border-danger-500",
            disabled && "border-transparent bg-03"
          )}
        >
          <input
            ref={ref}
            id={id}
            disabled={disabled}
            aria-invalid={hasError || undefined}
            aria-describedby={describedById}
            className={cn(
              "w-full min-w-0 flex-1 bg-transparent font-mono text-mono-sm text-01 outline-none placeholder:text-03 disabled:cursor-not-allowed disabled:text-03",
              className
            )}
            {...props}
          />
          {suffix ? (
            <span
              className={cn(
                "shrink-0 font-mono text-mono-13 text-03",
                hasError && "text-danger-500"
              )}
            >
              {suffix}
            </span>
          ) : null}
        </div>
        {helpText ? (
          <p
            id={describedById}
            role={hasError ? "alert" : undefined}
            className={cn("text-body-xs text-03", hasError && "text-danger-500")}
          >
            {helpText}
          </p>
        ) : null}
      </label>
    );
  }
);
Field.displayName = "Field";

export { Field };
