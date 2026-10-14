"use client";

import { ChartNoAxesColumn, Compass, House, SlidersHorizontal, Wallet } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

import { BUYER_NAV_ITEMS, type BuyerSectionId } from "./nav-config";

/**
 * Bottom Tab Bar: the buyer shell's five sections below 768px, the same five
 * the top bar shows from 768 up (`nav-config.ts`). The rarer pages live in
 * the account menu in the mobile top bar, so there is no "More" tab.
 */

export type TabBarTabId = BuyerSectionId;

const ICONS: Record<BuyerSectionId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  overview: House,
  activity: ChartNoAxesColumn,
  money: Wallet,
  controls: SlidersHorizontal,
  explore: Compass,
};

const TABS = BUYER_NAV_ITEMS.map((item) => ({ id: item.id, label: item.label, icon: ICONS[item.id] }));

export interface BottomTabBarProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  /** Currently active tab; null on a page outside the five sections. */
  active: TabBarTabId | null;
  /** Called when a tab without an `href` is activated. */
  onTabChange?: (id: TabBarTabId) => void;
  /** Render a tab as a real link instead of a button. */
  hrefs?: Partial<Record<TabBarTabId, string>>;
  /** Notification dot per tab. Every sampled screen ships this off. */
  badges?: Partial<Record<TabBarTabId, boolean>>;
  /** Element used for tabs with an `href`; pass Next's `Link` to avoid full reloads. */
  linkAs?: React.ElementType;
}

export const BottomTabBar = React.forwardRef<HTMLElement, BottomTabBarProps>(
  ({ className, active, onTabChange, hrefs, badges, linkAs: LinkComponent = "a", ...props }, ref) => {
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
              <LinkComponent
                key={id}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={sharedClassName}
              >
                {content}
              </LinkComponent>
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
