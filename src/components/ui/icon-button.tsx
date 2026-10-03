import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Design: "Icon Button", found inside the design's Button Bench, small
 * row. Only one instance is drawn — a 34x34
 * square, `border-02` stroke, `bg-01` fill, a single 16x16 "ellipsis" icon at
 * `text-02`. No size variant, no hover/focus/disabled/tone variant is drawn
 * anywhere for this component; everything below except the default look is
 * inferred, not read off the design.
 */
const iconButtonVariants = cva(
  "inline-flex size-[34px] shrink-0 items-center justify-center rounded-md border border-02 bg-01 text-02 transition-colors hover:bg-02 active:bg-03 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-03 disabled:text-03 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Render as the single child passed in, via Radix Slot, instead of a `<button>`. */
  asChild?: boolean;
  /** The icon to render, 16x16, `currentColor`-aware. */
  icon: React.ReactNode;
  /**
   * Icon-only control — there is no visible label, so an accessible name is
   * required. Passed straight through to the underlying element.
   */
  "aria-label": string;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, asChild = false, icon, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp className={cn(iconButtonVariants(), className)} ref={ref} {...props}>
        {icon}
      </Comp>
    );
  }
);
IconButton.displayName = "IconButton";

export { IconButton, iconButtonVariants };
