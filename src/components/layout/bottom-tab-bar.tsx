"use client";

import { ChartNoAxesColumn, Ellipsis, Gauge, House, Wallet } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Bottom Tab Bar.
 *
 * The bench's default content ("Guarantee" / shield-check, "Approvals" /
 * user-check with a notification dot) is placeholder: all three screens that
 * instance this component (Overview, Spend, Limits — all mobile 390) override it identically to "Funding" / wallet and "Limits" /
 * gauge, with the dot disabled every time. This build ships the real,
 * reconciled 5-slot navigation rather than the bench's stale labels.
 */

export type TabBarTabId = "overview" | "spend" | "funding" | "limits" | "more";

function MoreIcon(props: React.SVGProps<SVGSVGElement>) {
  return <Ellipsis fill="currentColor" stroke="none" {...props} />;
}

const TABS: {
  id: TabBarTabId;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}[] = [
  { id: "overview", label: "Overview", icon: House },
  { id: "spend", label: "Spend", icon: ChartNoAxesColumn },
  { id: "funding", label: "Funding", icon: Wallet },
  { id: "limits", label: "Limits", icon: Gauge },
  { id: "more", label: "More", icon: MoreIcon },
];

export interface BottomTabBarProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  /** Currently active tab. */
  active: TabBarTabId;
  /** Called when a tab without an `href` is activated. */
  onTabChange?: (id: TabBarTabId) => void;
  /** Render a tab as a real link instead of a button. */
  hrefs?: Partial<Record<TabBarTabId, string>>;
  /** Notification dot per tab. Every sampled screen ships this off. */
  badges?: Partial<Record<TabBarTabId, boolean>>;
}

export const BottomTabBar = React.forwardRef<HTMLElement, BottomTabBarProps>(
  ({ className, active, onTabChange, hrefs, badges, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        aria-label="Primary"
        className={cn(
          "flex w-full items-stretch gap-0 border-t border-01 bg-01 px-2 pb-5 pt-2",
          className
        )}
        {...props}
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = id === active;
          const href = hrefs?.[id];
          const showBadge = badges?.[id] ?? false;

          const content = (
            <>
              <span className="relative flex h-5 w-5 items-center justify-center">
                <Icon className={cn("h-5 w-5", isActive ? "text-primary-500" : "text-03")} />
                {showBadge ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger-500"
                  />
                ) : null}
              </span>
              <span
                className={cn(
                  "text-label-xs",
                  isActive ? "text-primary-500" : "text-03"
                )}
              >
                {label}
              </span>
              {showBadge ? (
                <span className="sr-only">, has notifications</span>
              ) : null}
            </>
          );

          const sharedClassName = cn(
            "flex flex-1 flex-col items-center justify-center gap-1 rounded-md py-2",
            isActive && "bg-primary-10",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
          );

          if (href) {
            return (
              <a
                key={id}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={sharedClassName}
              >
                {content}
              </a>
            );
          }

          return (
            <button
              key={id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onTabChange?.(id)}
              className={sharedClassName}
            >
              {content}
            </button>
          );
        })}
      </nav>
    );
  }
);
BottomTabBar.displayName = "BottomTabBar";
