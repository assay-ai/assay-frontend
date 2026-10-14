"use client";

import { usePathname } from "next/navigation";

import { MinimalBar } from "@/components/layout/minimal-bar";
import { AccountBlockBanner } from "@/features/account-block/account-block-banner";

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
 *
 * ## The bar's copy
 *
 * The left slot is a pathname map of real screen names; the design's sample
 * facts (a demo company, a step counter, timestamps, counts) are not rendered
 * because nothing computes them. There is no shadow-mode route.
 *
 * ## Body
 *
 * `layout vertical`, `gap 16`, `padding [22, 26]` on the provider setup, binding traffic and
 * verdicts-and-flags screens; the page ground is `$bg-02` on the four
 * frames. **The provider view screen's body diverges**: `gap 18`, `padding [24, 28]`.
 * The layout applies the three-way majority and `/provider/view` overrides it
 * on its own root element — do not change the default for it.
 */

/*
  Only what is true of the route itself. The design's frames carried sample
  facts ("provider.example", "step 2 of 4", "as of 12:41 UTC", "612 in the last
  24h") that nothing computes, so they are not rendered; a screen that wants a
  live status in the bar has to lift real data here first.
*/
const BAR_CONTEXT: Record<string, string> = {
  "/provider/view": "Provider view",
  "/provider/setup": "Provider setup",
  "/provider/traffic": "Binding and traffic",
  "/provider/flags": "Verdicts",
};

function contextFor(pathname: string): string {
  if (BAR_CONTEXT[pathname]) return BAR_CONTEXT[pathname];
  const match = Object.keys(BAR_CONTEXT)
    .filter((href) => pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0];
  return match ? BAR_CONTEXT[match] : "Provider";
}

export default function MinimalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const context = contextFor(pathname);
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
        <MinimalBar context={context} />
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
        {/* Not on /login: no session there, and the status read would 401. */}
        {!isLogin && <AccountBlockBanner wrapperClassName="w-full" />}
        {children}
      </main>
    </div>
  );
}
