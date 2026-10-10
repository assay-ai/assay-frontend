"use client";

import { Bell, Search } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Mobile Top Bar.
 *
 * Real usage (Overview, Spend, Receipt, Limits and Live SLA — all mobile
 * 390) never leaves the subtitle as a balance figure:
 * it carries call-budget counts, session windows, receipt ids and binding
 * ids. The Foundations "Breakpoints" frame describes this row as "title +
 * balance"; the built component is truer to the five real screens and takes
 * a generic `subtitle` instead.
 */

export interface MobileTopBarProps
  extends React.HTMLAttributes<HTMLElement> {
  /** Screen title, e.g. "Overview", "Spend", "Receipt 4471-3310". */
  title: string;
  /**
   * Contextual subtitle rendered in mono under the title, e.g.
   * "5 of 7 allowed", "last night · 18:00–06:00", "agent prod · policy v7".
   */
  subtitle?: string;
  /** Show the search action. Defaults to true, matching every sampled screen. */
  showSearch?: boolean;
  onSearch?: () => void;
  searchLabel?: string;
  /** Show the alerts action. Defaults to true, matching every sampled screen. */
  showAlerts?: boolean;
  onAlertsClick?: () => void;
  /** Unread alert count shown in the badge. */
  alertCount?: number;
  /** Trailing slot after the alerts action; the buyer shell puts the account menu here. */
  avatar?: React.ReactNode;
}

export const MobileTopBar = React.forwardRef<HTMLElement, MobileTopBarProps>(
  (
    {
      className,
      title,
      subtitle,
      showSearch = true,
      onSearch,
      searchLabel = "Search",
      showAlerts = true,
      onAlertsClick,
      alertCount = 2,
      avatar,
      ...props
    },
    ref
  ) => {
    return (
      <header
        ref={ref}
        className={cn(
          "flex w-full items-center gap-3 border-b border-01 bg-01 px-4 py-2.5",
          className
        )}
        {...props}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <h1 className="truncate text-label-md text-01">{title}</h1>
          {subtitle ? (
            <p className="truncate font-mono text-mono-xs text-03">
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showSearch ? (
            <button
              type="button"
              onClick={onSearch}
              aria-label={searchLabel}
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-md border border-02 bg-01 text-02",
                "before:absolute before:-inset-1 before:content-['']",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
              )}
            >
              <Search className="h-4 w-4" />
            </button>
          ) : null}

          {showAlerts ? (
            <button
              type="button"
              onClick={onAlertsClick}
              aria-label={
                alertCount > 0 ? `${alertCount} unread alerts` : "Alerts"
              }
              className={cn(
                "relative flex items-center gap-1.5 rounded-md bg-warning-10 px-2.5 py-1.5",
                "before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
              )}
            >
              <Bell className="h-4 w-4 text-warning-600" />
              <span className="font-mono text-mono-sm text-warning-700">
                {alertCount}
              </span>
            </button>
          ) : null}

          {avatar}
        </div>
      </header>
    );
  }
);
MobileTopBar.displayName = "MobileTopBar";
