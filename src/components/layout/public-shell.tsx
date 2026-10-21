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
import { markPublicShell } from "@/providers/buyer-session";

/**
 * The public shell: the public top bar over the page and the public footer
 * under it. The `(public)` layout wraps every public page in it, and the 404
 * page uses it too, so a mistyped address still looks like the product and
 * offers the way back. Each page owns its own body frame (padding differs
 * between a full-bleed hero and a list page).
 *
 * "Demo" (top bar) and "Proof of reserves" (footer) appear only where the
 * deployment publishes them (`GET /public/features`).
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const { demo, reserves } = usePublicFeatures();
  // A 401 here clears the token and stays (the 404 page too, whose address is no public path).
  React.useEffect(() => markPublicShell(), []);
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
      <PublicFooter linkAs={Link} signedIn={signedIn} reserves={reserves} />
    </div>
  );
}
