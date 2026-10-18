"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/utils";

/**
 * Explore's views as route tabs: Tools (`/explore`, the main list),
 * Providers (`/explore/providers`) and the shared Tool sets
 * (`/explore/toolsets`). Real links, so each can be deep-linked.
 */
const TABS = [
  { href: "/explore", label: "Tools", match: (p: string) => p === "/explore" || p === "/explore/tools" || p.startsWith("/explore/tools/") },
  { href: "/explore/providers", label: "Providers", match: (p: string) => p.startsWith("/explore/providers") },
  { href: "/explore/toolsets", label: "Tool sets", match: (p: string) => p.startsWith("/explore/toolsets") },
];

export function ExploreNav() {
  const pathname = usePathname();

  return (
    <div role="tablist" aria-label="Explore" className="flex w-full items-end gap-[26px] border-b border-01">
      {TABS.map((tab) => {
        const selected = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={selected}
            className={cn(
              "flex items-center gap-1.5 border-b-2 pb-[10px] text-label-sm transition-colors",
              selected ? "border-b-[var(--text-01)] text-01" : "border-transparent text-02 hover:text-01"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
