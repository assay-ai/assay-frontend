"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/utils";

/**
 * The single "Explore" surface: two tabs, Providers and Tools, over three
 * routes (`/explore/providers`, `/explore/tools`, `/explore/providers/[id]`).
 *
 * The design draws seven tabs on both explore screens — "Providers, Tools,
 * Failed 92, Passing 60, Excluded 38, Policy v3, Attestation". The last five
 * are stale: they are the Verdicts screen's tab strip, carried over when the
 * screen was copied in the design, and they name counts and a policy version that have
 * nothing to do with a catalogue. Only the two that belong are rendered.
 *
 * Styling is `TabsList`/`TabsTrigger`'s (26px gap, 1px `$border-01` rule, 2px
 * `$text-01` underline on the selected tab) rather than the component itself,
 * because these tabs are routes: each must be a real link so that a tab can be
 * opened in a new window and deep-linked.
 */
const TABS = [
  { href: "/explore/providers", label: "Providers" },
  { href: "/explore/tools", label: "Tools" },
];

export function ExploreNav() {
  const pathname = usePathname();

  return (
    <div role="tablist" aria-label="Explore" className="flex w-full items-end gap-[26px] border-b border-01">
      {TABS.map((tab) => {
        const selected = pathname.startsWith(tab.href);
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
