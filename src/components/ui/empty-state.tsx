import { ReceiptText } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Empty State, as drawn in the product design.
 *
 * The only instance in the design is the "no calls yet" screen, whose copy
 * is a product rule in miniature — it explains that a zero here is the
 * absence of a failed call, not a broken counter — so title/description
 * default to that copy verbatim rather than being required props. Anything
 * that renders this with no override matches the design exactly; screens
 * that need a different empty state override title/description/icon.
 */

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    {
      className,
      icon = <ReceiptText width={22} height={22} />,
      title = "No calls yet",
      description = "When a call fails our checks you are not charged for it, and the amount appears here.",
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        "flex w-full max-w-[420px] flex-col gap-2.5 rounded-xl border border-01 bg-02 p-8",
        className
      )}
      {...props}
    >
      {icon && <div className="text-03">{icon}</div>}
      <p className="text-label-md text-01">{title}</p>
      {description && <p className="text-body-13 text-02">{description}</p>}
    </div>
  )
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
