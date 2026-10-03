import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Design: "Button", from the design's "Button Bench".
 *
 * The bench draws a single size/tone matrix — five tones (primary, secondary,
 * ghost, danger, success) at the default size, the same five tones again at
 * `sm` (only three of the five re-drawn: primary/secondary/ghost), and one
 * `Button Disabled` instance. Hover/focus/loading are not drawn anywhere on a
 * static canvas — those interaction states below are inferred, not read off
 * the design.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md shadow-hair transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-03 disabled:text-03 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary-500 text-on-color hover:bg-primary-600 active:bg-primary-700",
        secondary:
          "border border-02 bg-01 text-01 hover:bg-02 active:bg-03",
        ghost: "bg-transparent text-02 hover:bg-02 active:bg-03",
        danger: "bg-danger-500 text-on-color hover:bg-danger-600 active:bg-danger-700",
        success: "bg-success-500 text-on-color hover:bg-success-600 active:bg-success-700",
      },
      size: {
        default: "gap-[7px] px-3.5 py-[9px] text-label-sm [&_svg]:size-[15px]",
        sm: "gap-1.5 px-2.5 py-1.5 text-label-13 [&_svg]:size-[13px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the single child passed in, via Radix Slot, instead of a `<button>`. */
  asChild?: boolean;
  /**
   * Not drawn in the design (the bench has no loading row) — added so that
   * every reachable interaction state has a prop. Swaps the
   * leading icon for a spinner and disables the button.
   */
  loading?: boolean;
  /** Leading icon. Sized by the button's `size` via `[&_svg]:size-*`; pass any `currentColor`-aware icon. */
  icon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading, icon, children, disabled, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    const ornament = loading ? (
      <svg
        className="size-[15px] animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    ) : (
      icon
    );

    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        // Slot forwards to whatever element the caller passed, which may not be
        // a <button> and would choke on these.
        disabled={asChild ? undefined : disabled || loading}
        aria-disabled={asChild && (disabled || loading) ? true : undefined}
        aria-busy={loading || undefined}
        {...props}
      >
        {/*
          Radix Slot merges props onto exactly ONE child and calls
          React.Children.only, so an `asChild` button must pass its child
          through untouched. Rendering the icon/spinner alongside it makes two
          children and throws at render time — which is what broke not-found.tsx,
          where <Button asChild><Link/></Button> is the only usage in the app.
          A caller that needs an icon inside an asChild button puts it inside
          their own child element.
        */}
        {asChild ? (
          children
        ) : (
          <>
            {ornament}
            {children}
          </>
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
