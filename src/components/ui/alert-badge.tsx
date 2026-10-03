"use client";

import { Bell } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Alert Badge.
 *
 * This is a NOTIFICATION COUNT, not a verdict badge — it does not share
 * vocabulary with `Badge`/`Tag` (no `variant`/`type` props, no PASS/FAIL
 * language). Per Foundations rule 4 ("stop, tell and ask are three
 * different regions"), an alert is the "tell" region only: it surfaces a
 * count and opens a panel, it never disables itself and never blocks
 * anything, so this component has no `disabled` state by design.
 *
 * The design only shows the "2 unread" state (`$warning-10` fill,
 * `$warning-600` icon, `$warning-700` count). The zero-alerts state isn't
 * in the design; a muted neutral rendering is this component's own
 * assumption.
 */

export interface AlertBadgeProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  /** Number of unread alerts. */
  count: number;
  /** Count above which the badge shows "{max}+" instead of the exact number. Default 9. */
  max?: number;
  /** Overrides the generated aria-label. */
  label?: string;
}

const AlertBadge = React.forwardRef<HTMLButtonElement, AlertBadgeProps>(
  ({ count, max = 9, label, className, ...props }, ref) => {
    const hasAlerts = count > 0;
    const display = count > max ? `${max}+` : String(count);
    const accessibleLabel =
      label ?? (hasAlerts ? `${count} alert${count === 1 ? "" : "s"} need your attention` : "No alerts");

    return (
      <button
        ref={ref}
        type="button"
        aria-label={accessibleLabel}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
          hasAlerts ? "bg-warning-10 hover:bg-warning-20" : "bg-03 hover:bg-04",
          className
        )}
        {...props}
      >
        <Bell
          className={cn("h-[15px] w-[15px]", hasAlerts ? "text-warning-600" : "text-03")}
        />
        {hasAlerts && (
          <span className="text-mono-13 font-mono font-semibold leading-none text-warning-700">
            {display}
          </span>
        )}
      </button>
    );
  }
);
AlertBadge.displayName = "AlertBadge";

export { AlertBadge };
