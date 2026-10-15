"use client";

import * as React from "react";

import { cn } from "@/utils";

import { PROVIDER_NAV_ITEMS, type ProviderSectionId } from "./provider-nav-config";
import { PROVIDER_NAV_ICONS } from "./sidebar";

/**
 * The provider console below tablet: five sections as a bottom tab bar
 * (Home, Tools, Penalties, Money, Stake). Inbox and Account sit in the phone
 * top bar, so nothing hides behind a "More" tab.
 */
export function ProviderTabBar({
  active,
  counts = {},
  linkAs: LinkComponent = "a",
  className,
}: {
  active: ProviderSectionId | null;
  counts?: Partial<Record<ProviderSectionId, number>>;
  linkAs?: React.ElementType;
  className?: string;
}) {
  return (
    <nav
      aria-label="Provider console"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex w-full items-stretch border-t border-01 bg-01 px-2 pb-[max(env(safe-area-inset-bottom),12px)] pt-2",
        className,
      )}
    >
      {PROVIDER_NAV_ITEMS.filter((item) => item.phoneTab).map((item) => {
        const Icon = PROVIDER_NAV_ICONS[item.id];
        const isActive = item.id === active;
        const count = counts[item.id] ?? 0;
        return (
          <LinkComponent
            key={item.id}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md py-1.5",
              isActive && "bg-primary-10",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
            )}
          >
            <span className="relative flex h-5 w-5 items-center justify-center">
              <Icon aria-hidden="true" className={cn("h-5 w-5", isActive ? "text-primary-500" : "text-03")} />
              {count > 0 ? (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 font-mono text-mono-2xs font-semibold text-on-color">
                  {count > 9 ? "9+" : count}
                </span>
              ) : null}
            </span>
            <span className={cn("truncate text-label-xs", isActive ? "text-primary-500" : "text-03")}>{item.label}</span>
            {count > 0 ? <span className="sr-only">, {count} need you</span> : null}
          </LinkComponent>
        );
      })}
    </nav>
  );
}
