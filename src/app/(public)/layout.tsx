"use client";

import Link from "next/link";

import { PublicTopBar, publicNavItems } from "@/components/layout/public-top-bar";
import { usePublicFeatures } from "@/features/explorer/use-public-explorer";

/**
 * The public shell: the public top bar over each page. Each page owns its own
 * body frame (padding differs between a full-bleed hero and a list page).
 *
 * | Screen                         | Route                               |
 * |--------------------------------|-------------------------------------|
 * | How it works                   | `/how-it-works`                     |
 * | Explorer (tools, proof feed)   | `/catalogue`                        |
 * | Tool / provider page           | `/catalogue/view`, `/catalogue/provider` |
 * | Live demo (when configured)    | `/demo`                             |
 * | For providers (+ calculator)   | `/why-list-here`                    |
 * | Reserves                       | `/reserves`                         |
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const { demo } = usePublicFeatures();
  return (
    <div className="flex min-h-screen flex-col bg-02">
      <PublicTopBar linkAs={Link} navItems={publicNavItems({ demo })} />
      <main className="flex w-full flex-1 flex-col">{children}</main>
    </div>
  );
}
