"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { cn } from "@/utils";

import { activeTabFor, BUYER_SECTION_TABS, type BuyerSectionId, type SectionTab } from "./nav-config";

/**
 * Tabs between the pages of one section — real links, one URL per tab, so a
 * tab can be bookmarked, shared and opened in a new window.
 *
 *   <SectionTabs tabs={[{ id: "spend", label: "Spend", href: "/spend" }, …]} />
 *   <BuyerSectionTabs section="activity" />   // the buyer shell's own tabs
 *
 * Styled like the in-page `Tabs` (underline on the active one), but rendered
 * as a `nav` with `aria-current="page"`, because these navigate between
 * pages; in-page panels use `components/ui/tabs.tsx`. Scrolls sideways at
 * phone width rather than wrapping.
 */
export interface SectionTabsProps {
  tabs: readonly SectionTab[];
  /** Accessible name. Default "Section". */
  label?: string;
  /** Override the active tab (default: from the current path). */
  activeId?: string;
  linkAs?: React.ElementType;
  className?: string;
}

export function SectionTabs({ tabs, label = "Section", activeId, linkAs: LinkComponent = Link, className }: SectionTabsProps) {
  const pathname = usePathname() ?? "";
  const active = activeId ?? activeTabFor(tabs, pathname);

  return (
    <nav aria-label={label} className={cn("w-full overflow-x-auto scrollbar-none", className)}>
      <ul className="flex w-max min-w-full items-end gap-[22px] border-b border-01 tablet:gap-[26px]">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <li key={tab.id} className="shrink-0">
              <LinkComponent
                href={tab.href}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center border-b-2 pb-[10px] pt-1 text-label-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                  selected ? "border-b-[var(--text-01)] text-01" : "border-transparent text-02 hover:text-01",
                )}
              >
                {tab.label}
                {tab.badge ? (
                  <span className="ml-1.5 rounded-full bg-danger-500 px-1.5 py-px font-mono text-mono-2xs font-semibold text-on-color">
                    {tab.badge > 99 ? "99+" : tab.badge}
                    <span className="sr-only"> needing attention</span>
                  </span>
                ) : null}
              </LinkComponent>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const SECTION_LABEL: Record<BuyerSectionId, string> = {
  overview: "Overview",
  activity: "Activity",
  money: "Money",
  controls: "Controls",
  explore: "Explore",
};

/**
 * The buyer section's tabs as a strip under the top bar. The buyer shell
 * (`app/(main)/layout.tsx`) renders it for every page of a section that has
 * tabs, so pages do NOT render it themselves.
 */
export function BuyerSectionTabs({ section, className }: { section: BuyerSectionId | null; className?: string }) {
  const tabs = section ? BUYER_SECTION_TABS[section] : undefined;
  if (!section || !tabs) return null;
  return (
    <div className={cn("w-full bg-01 px-4 pt-2.5 tablet:px-7", className)}>
      <SectionTabs tabs={tabs} label={`${SECTION_LABEL[section]} pages`} />
    </div>
  );
}
