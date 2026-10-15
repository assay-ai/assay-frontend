"use client";

import { useQuery } from "@tanstack/react-query";
import { Inbox as InboxIcon, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type * as React from "react";
import { Toaster } from "sonner";

import { AlertFill, CheckCircle } from "@/components/icons";
import { MobileTopBar } from "@/components/layout/mobile-top-bar";
import { providerSectionFor, providerTitleFor } from "@/components/layout/provider-nav-config";
import { ProviderTabBar } from "@/components/layout/provider-tab-bar";
import { Sidebar, type SidebarBindingItem } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { AccountBlockBanner } from "@/features/account-block/account-block-banner";
import { SlashHoldBanner } from "@/features/slash-hold/slash-hold-banner";
import { ChecklistPill } from "@/components/patterns/setup-checklist";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { useListingProgress } from "@/features/provider-home/use-listing-progress";
import { useProviderInbox } from "@/features/provider-home/use-provider-inbox";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { useTheme } from "@/providers/ThemeProvider";
import { routes } from "@/libs/routes";

/**
 * The provider console shell — the design's "Sidebar" component, used by
 * every console screen whose first child is a `ref` to it (29 screens).
 *
 * ## The sidebar is NOT the rounded card in this shell
 *
 * The design on its own is a 248px `$bg-02` card with `$radius-lg` and a 1px
 * border all round — that is how `sidebar.tsx` implements it, and that is
 * right. But **every one of the 29 console frames overrides it** at the `ref`:
 *
 *     height: fill_container, cornerRadius: 0, fill: $bg-01,
 *     stroke: $border-01, strokeWidth: { right: 1 }
 *
 * i.e. a full-height flush rail with a single right hairline. Those four
 * overrides are applied here as `className`, so no screen has to know about
 * them and `sidebar.tsx` stays the component the design bench draws.
 *
 * ## Main
 *
 * Verbatim and identical on every console frame sampled (registration, verdict
 * feed, live SLA position, reconciliation): `layout vertical`, `gap 16`,
 * `padding [22, 26]`, filling the remaining width. Screens render their own
 * sections straight into it.
 *
 * ## Responsive
 *
 * Foundations > Breakpoints says the provider rail "collapses to
 * icons" at tablet, and the provider home's tablet (834) design confirms it by
 * using the sidebar at `width 64`. `sidebar.tsx` already implements both widths and
 * hides itself below tablet. Below tablet the design shells the console with
 * the Mobile Top Bar instead (see the live SLA position screen's mobile 390 design), with
 * no bottom tab bar — the tab bar is the buyer's, and the provider frames do
 * not draw one. Both chromes are always in the DOM and CSS picks, matching
 * `(main)/layout.tsx`, so the first paint is correct at either width.
 */

/** The binding a screen is about: its id rides in `?binding=` (see `libs/routes.ts`). */
function bindingIdFrom(pathname: string, bindingParam: string | null): string | null {
  return pathname.startsWith("/provider/bindings/view") && bindingParam ? bindingParam : null;
}

function PhoneIconLink({
  href,
  label,
  count = 0,
  active,
  children,
}: {
  href: string;
  label: string;
  count?: number;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={count > 0 ? `${label}, ${count} new` : label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-md border border-02 bg-01 text-02",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
        active && "border-primary-500 text-primary-600",
      )}
    >
      {children}
      {count > 0 ? (
        <span aria-hidden="true" className="absolute -right-1 -top-1 size-2.5 rounded-full bg-danger-500" />
      ) : null}
    </Link>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { themeType } = useTheme();
  const pathname = usePathname();
  const bindingParam = useSearchParams().get("binding");

  /*
    The rail's binding list is shell data, so it is fetched once here rather
    than by each of the screens that sits inside it.

    An unregistered organization gets **200 with an empty page** from this
    route, not a 404 — same for `stake` and `earnings`. So screens inside this
    shell must handle that persona through their EMPTY branch, not their error
    branch.

    `GET /providers/me/registration` is the exception and genuinely does
    404 `PROVIDER_NOT_FOUND`; a screen reading that one needs both paths. (Two
    earlier versions of this comment were wrong in opposite directions — first
    claiming everything 404s, then claiming nothing does.)

    Either way `items` is empty here and the rail renders its fixed rows, which
    is the correct state for a provider with no bindings.
  */
  const { data } = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });
  const names = useProviderToolNames();
  // The same read as the Inbox page, so the badge equals what the page says.
  const inbox = useProviderInbox();
  const penalties = inbox.penalties;
  const progress = useListingProgress();

  const bindings: SidebarBindingItem[] = (data?.items ?? []).map((binding) => ({
    id: binding.id,
    label: names.bindingLabel(binding),
    status: binding.status === "ACTIVE" ? "live" : "paused",
    href: routes.binding(binding.id),
  }));

  const section = providerSectionFor(pathname);
  const activeId = bindingIdFrom(pathname, bindingParam) ?? section ?? undefined;
  const counts = { penalties: penalties.count, inbox: inbox.count };

  // "Get listed 2/5" until the first tool is live. Not on Home, which shows the checklist itself.
  const showPill = !progress.loading && !progress.live && !progress.isError;
  const pill = showPill ? (
    <ChecklistPill label="Get listed" steps={progress.steps} href="/provider" linkAs={Link} />
  ) : null;

  return (
    <div className="flex min-h-screen flex-col bg-02 tablet:flex-row">
      <div className="sticky top-0 z-30 tablet:hidden">
        <MobileTopBar
          title={providerTitleFor(pathname)}
          showSearch={false}
          showAlerts={false}
          avatar={
            <div className="flex items-center gap-2">
              {pathname !== "/provider" ? pill : null}
              <PhoneIconLink href="/provider/inbox" label="Inbox" count={counts.inbox} active={section === "inbox"}>
                <InboxIcon aria-hidden="true" className="size-4" />
              </PhoneIconLink>
              <PhoneIconLink href="/provider/account" label="Account" active={section === "account"}>
                <UserRound aria-hidden="true" className="size-4" />
              </PhoneIconLink>
            </div>
          }
        />
      </div>

      <Sidebar
        className="sticky top-0 h-screen shrink-0 overflow-y-auto rounded-none border-0 border-r bg-01"
        activeItemId={activeId}
        counts={counts}
        bindings={bindings}
        header={pill}
        linkAs={Link}
        footer={<ThemeToggle />}
      />

      {/* Desktop Main: gap 16, padding [22, 26]. Mobile Content
          (mobile 390): gap 14, padding 16. */}
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 p-4 pb-28 tablet:gap-4 tablet:px-[26px] tablet:py-[22px]">
        {/* Shell level, above every console screen: see `features/account-block`. */}
        <AccountBlockBanner wrapperClassName="w-full" />
        {/* Shell level too: a slash hold stops routing on every binding at once. */}
        <SlashHoldBanner wrapperClassName="w-full" />
        {children}
      </main>

      <div className="tablet:hidden">
        <ProviderTabBar active={section} counts={counts} linkAs={Link} />
      </div>

      {/* Without a mounted Toaster every `toast()` on a console screen is a
          silent no-op — BUG-J-PROV-02's "Publish gives no feedback" was this.
          Same props as `(main)` and `(operator)`. */}
      <Toaster
        theme={themeType}
        position="top-center"
        icons={{
          success: <CheckCircle className="mt-2 text-xl" />,
          error: <AlertFill className="mt-2 text-danger-500" />,
        }}
      />
    </div>
  );
}
