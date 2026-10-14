"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

import { AlertFill, CheckCircle } from "@/components/icons";
import { MobileTopBar } from "@/components/layout/mobile-top-bar";
import { Sidebar, type SidebarBindingItem } from "@/components/layout/sidebar";
import { AccountBlockBanner } from "@/features/account-block/account-block-banner";
import { SlashHoldBanner } from "@/features/slash-hold/slash-hold-banner";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { labelForEndpoint } from "@/utils/provider-label";

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

/** `/provider/bindings/<id>/…` → `<id>`, else null. */
function bindingIdFrom(pathname: string): string | null {
  const match = /^\/provider\/bindings\/([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

const SECTIONS: { prefix: string; id: string }[] = [
  { prefix: "/provider/inbox", id: "inbox" },
  { prefix: "/provider/capital", id: "capital" },
  { prefix: "/provider/money", id: "money" },
  { prefix: "/provider/policy-changes", id: "policy-changes" },
  { prefix: "/provider/account", id: "account" },
];

function activeItemFor(pathname: string): string | undefined {
  if (pathname === "/provider") return "home";
  const binding = bindingIdFrom(pathname);
  if (binding) return binding;
  return SECTIONS.find((s) => pathname.startsWith(s.prefix))?.id;
}

/** Titles for the mobile chrome. Longest prefix wins, as in `(main)`. */
const TITLES: Record<string, string> = {
  "/provider": "Home",
  "/provider/inbox": "Inbox",
  "/provider/register": "Registration",
  "/provider/listing-path": "Listing path",
  "/provider/capital": "Capital",
  "/provider/capital/penalties": "Penalties on chain",
  "/provider/money": "Money",
  "/provider/money/reconciliation": "Reconciliation",
  "/provider/policy-changes": "Policy changes",
  "/provider/portfolio": "Portfolio",
  "/provider/account": "Account",
  "/provider/account/notifications": "Notifications",
  "/provider/disputes": "Disputes",
  "/provider/exit": "Exit checklist",
  "/provider/tool-requests": "Tool requests",
  "/provider/cases": "Case",
  "/provider/agent-traffic": "Agent traffic",
  "/provider/bindings": "Binding",
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const match = Object.keys(TITLES)
    .filter((href) => href !== "/provider" && pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0];
  return match ? TITLES[match] : "GoAssay.AI";
}

/**
 * The design labels each binding row with the tool's slug (`search_web`,
 * `ais_lookup`). `GET /providers/me/tool-bindings` returns `toolId` as a bare
 * UUID and the detail route adds nothing, so the rail shows the endpoint's
 * host — the only human-readable identifier those responses carry.
 *
 * **A tool name is now reachable** — `GET
 * /providers/me/tool-bindings/catalogue` — and `/provider/bindings`
 * renders real names from it. The rail does not, because it would have to hold
 * a second query for chrome that every screen underneath already resolves for
 * itself. That is a deliberate stop, not an oversight: it costs one request on
 * every console page to relabel a list the user is about to click through.
 *
 * If it is taken, take it in `labelForEndpoint`'s caller, not by re-deriving a
 * name here — five copies of that helper is what the shared version exists to
 * undo.
 */

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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

  const bindings: SidebarBindingItem[] = (data?.items ?? []).map((binding) => ({
    id: binding.id,
    label: labelForEndpoint(binding.endpoint),
    status: binding.status === "ACTIVE" ? "live" : "paused",
    href: `/provider/bindings/${binding.id}`,
  }));

  return (
    <div className="flex min-h-screen flex-col bg-02 tablet:flex-row">
      <div className="tablet:hidden">
        <MobileTopBar title={titleFor(pathname)} showSearch={false} showAlerts={false} />
      </div>

      <Sidebar
        className="rounded-none border-0 border-r bg-01"
        activeItemId={activeItemFor(pathname)}
        homeHref="/provider"
        inboxHref="/provider/inbox"
        capitalHref="/provider/capital"
        moneyHref="/provider/money"
        policyChangesHref="/provider/policy-changes"
        accountHref="/provider/account"
        bindings={bindings}
      />

      {/* Desktop Main: gap 16, padding [22, 26]. Mobile Content
          (mobile 390): gap 14, padding 16. */}
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 p-4 tablet:gap-4 tablet:px-[26px] tablet:py-[22px]">
        {/* Shell level, above every console screen: see `features/account-block`. */}
        <AccountBlockBanner wrapperClassName="w-full" />
        {/* Shell level too: a slash hold stops routing on every binding at once. */}
        <SlashHoldBanner wrapperClassName="w-full" />
        {children}
      </main>

      {/* Without a mounted Toaster every `toast()` on a console screen is a
          silent no-op — BUG-J-PROV-02's "Publish gives no feedback" was this.
          Same props as `(main)` and `(operator)`. */}
      <Toaster
        position="top-center"
        icons={{
          success: <CheckCircle className="mt-2 text-xl" />,
          error: <AlertFill className="mt-2 text-danger-500" />,
        }}
      />
    </div>
  );
}
