"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { useSignedIn } from "@/components/explorer/start-free";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicTopBar, publicNavItems } from "@/components/layout/public-top-bar";
import { TestnetChip } from "@/components/patterns/testnet-chip";
import { usePublicFeatures } from "@/features/explorer/use-public-explorer";
import { demoEnabled } from "@/libs/demo/demo-api";
import { loginHref } from "@/libs/login-redirect";

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
  // The same rule as the pages' Connect panels, so the bar never says "Sign in" over a working Connect.
  const signedIn = useSignedIn() || demoEnabled();
  // Sign in and Start free come back to this page (never with a fragment: a link-only token stays in the tab).
  const pathname = usePathname();
  const [loginTo, setLoginTo] = React.useState("/login");
  React.useEffect(() => {
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    if (token) {
      try {
        // The tool set page picks it up again after sign-in (`?resume=1`).
        window.sessionStorage.setItem("assay.toolsets.pending-token", token);
      } catch {
        // Not kept: the person opens the link again after signing in.
      }
    }
    setLoginTo(loginHref({ next: token ? "/toolsets/view?resume=1" : `${pathname}${window.location.search}` }));
  }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col bg-02">
      <PublicTopBar
        linkAs={Link}
        navItems={publicNavItems({ demo })}
        signedIn={signedIn}
        signInHref={loginTo}
        startFreeHref={loginTo}
        badge={<TestnetChip compact />}
      />
      <main className="flex w-full flex-1 flex-col">{children}</main>
      <PublicFooter linkAs={Link} signedIn={signedIn} />
    </div>
  );
}
