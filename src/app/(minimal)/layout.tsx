"use client";

import { usePathname } from "next/navigation";

import { MinimalBar } from "@/components/layout/minimal-bar";

/**
 * The sidebar-less provider shell — the design's 56px "Bar", extracted into
 * `@/components/layout/minimal-bar` (see that file for the five frames that
 * each carry a local copy of it).
 *
 * | Screen              | Route                    |
 * |---------------------|--------------------------|
 * | Provider view       | `/provider/view`         |
 * | Provider setup      | `/provider/setup`        |
 * | Binding and traffic | `/provider/traffic`      |
 * | Verdicts and flags  | `/provider/flags`        |
 * | Shadow mode         | `/provider/shadow-mode`  |
 *
 * ## Why the bar's copy lives in the layout
 *
 * Both text slots are per-screen, and both are static copy in the design, so
 * they are a pathname map here — the same shape `(main)/layout.tsx` already
 * uses for its mobile titles. A screen gets the correct bar for free and
 * writes no shell code.
 *
 * That map is the seam for live data. "as of 12:41 UTC" and "612 in the last
 * 24h" are placeholders a screen will eventually want to compute; when one
 * does, lift `status` out of this table rather than rendering a second bar.
 *
 * ## Body
 *
 * `layout vertical`, `gap 16`, `padding [22, 26]` on the provider setup, binding traffic and
 * verdicts-and-flags screens; the page ground is `$bg-02` on all five
 * frames. **The provider view screen's body diverges**: `gap 18`, `padding [24, 28]`.
 * The layout applies the three-way majority and `/provider/view` overrides it
 * on its own root element — do not change the default for it.
 */

interface BarCopy {
  /** Verbatim from the frame's own Bar copy. */
  context: string;
  status?: string;
}

const BAR_COPY: Record<string, BarCopy> = {
  "/provider/view": { context: "Provider view · provider.example", status: "as of 12:41 UTC" },
  "/provider/setup": { context: "Provider setup · provider.example", status: "step 2 of 4" },
  "/provider/traffic": {
    context: "provider.example · binding ais_lookup",
    status: "as of 12:41 UTC",
  },
  "/provider/flags": {
    context: "provider.example · verdicts",
    status: "612 in the last 24h",
  },
  "/provider/shadow-mode": {
    context: "provider.example · shadow mode",
    status: "August 2026",
  },
};

function barCopyFor(pathname: string): BarCopy {
  if (BAR_COPY[pathname]) return BAR_COPY[pathname];
  const match = Object.keys(BAR_COPY)
    .filter((href) => pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0];
  return match ? BAR_COPY[match] : { context: "provider.example" };
}

export default function MinimalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { context, status } = barCopyFor(pathname);
  // /login has no signed-in tenant to show: an unauthenticated visitor must
  // never see a seeded demo company's name and avatar next to a sign-in
  // form. Every other route in this group keeps the bar unchanged.
  //
  // It also opts out of the group's page padding and its `$bg-02` ground:
  // /login is a two-pane screen whose panes run edge to edge and paint their
  // own grounds ($bg-inverse and $bg-01). The 26/22 padding here would frame
  // both of them in a grey border.
  const isLogin = pathname === "/login";

  return (
    <div className="flex min-h-screen flex-col bg-02">
      {!isLogin && (
        <MinimalBar context={context} status={status} avatarInitials="PE" avatarName="provider.example" />
      )}
      {/* This group is not just /login: /provider/setup, /provider/view,
          /provider/traffic and /provider/flags are all authenticated screens
          that a brand-new user can land on directly. They used to be wrapped
          in `WalletProvisioningGate`, which never once activated in a browser
          and was removed; a new user's first minute of 424s is again the
          unsolved problem it always was. */}
      <main
        className={
          isLogin
            ? "flex w-full flex-1 flex-col"
            : "flex w-full flex-1 flex-col gap-4 px-[26px] py-[22px]"
        }
      >
        {children}
      </main>
    </div>
  );
}
