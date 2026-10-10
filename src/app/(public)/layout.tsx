"use client";

import Link from "next/link";

import { PublicTopBar } from "@/components/layout/public-top-bar";

/**
 * The provider marketing shell — the design's "Public Top Bar" component.
 *
 * Used by every public screen whose first child is the public top bar:
 *
 * | Screen                           | Route                        |
 * |----------------------------------|------------------------------|
 * | Provider offer & risk disclosure | `/why-list-here`             |
 * | Economics calculator             | `/calculator`                |
 * | Catalogue and demand             | `/catalogue`                 |
 * | Tool contract and policy         | `/catalogue/[toolId]`        |
 *
 * The nav item hrefs already live in `public-top-bar.tsx`'s
 * `DEFAULT_PUBLIC_NAV_ITEMS` and match this table.
 *
 * **No body padding here, deliberately.** Unlike the console, the five public
 * frames do not agree on one body box: the why-list-here screen pads `[0, 28, 28, 28]` because a
 * full-bleed Hero sits flush under the bar, while the policy library screen pads `[22, 28]` with
 * gap 18. Imposing either would break the other, so each screen owns its own
 * body frame. The page ground is `$bg-02` on all five.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-02">
      <PublicTopBar linkAs={Link} />
      <main className="flex w-full flex-1 flex-col">{children}</main>
    </div>
  );
}
