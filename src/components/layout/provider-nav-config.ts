import type { SectionTab } from "./nav-config";

/**
 * The provider console's navigation — one file, so the sidebar, the phone
 * tab bar, the mobile title and the tests agree about where a page lives.
 *
 *   Home        /provider                     (Get listed checklist until live)
 *   Inbox       /provider/inbox
 *   Listings    /provider/bindings            your listings; a listing's pages; your APIs
 *                                             (/provider/apis); tool requests
 *   Penalties   /provider/penalties           badge = penalties that need you; buyer reports
 *                                             about bad results (/provider/call-disputes)
 *   Money       /provider/money
 *   Stake       /provider/capital             withdraw stake is a sheet here
 *   Account     /provider/account             policy changes sit under it
 *
 * Words: a **listing** is a provider's endpoint serving a catalogue tool (the
 * routes say "bindings"; no screen does), **your APIs** are the tools only
 * this provider serves (`/provider/apis`), and a **tool request** asks Assay
 * for a catalogue tool. `features/provider-binding/listing-copy.ts` has the
 * one sentence that tells them apart.
 */

export type ProviderSectionId = "home" | "inbox" | "tools" | "penalties" | "money" | "stake" | "account";

export interface ProviderNavItem {
  id: ProviderSectionId;
  label: string;
  href: string;
  /** Path prefixes that belong to this section. "/provider" matches only itself. */
  match: string[];
  /** Shown in the phone tab bar (the rest sit in the phone top bar). */
  phoneTab: boolean;
}

export const PROVIDER_NAV_ITEMS: ProviderNavItem[] = [
  { id: "home", label: "Home", href: "/provider", match: ["/provider"], phoneTab: true },
  { id: "inbox", label: "Inbox", href: "/provider/inbox", match: ["/provider/inbox"], phoneTab: false },
  {
    id: "tools",
    label: "Listings",
    href: "/provider/bindings",
    match: ["/provider/bindings", "/provider/apis", "/provider/tool-requests", "/provider/portfolio"],
    phoneTab: true,
  },
  {
    id: "penalties",
    label: "Penalties",
    href: "/provider/penalties",
    match: ["/provider/penalties", "/provider/call-disputes"],
    phoneTab: true,
  },
  { id: "money", label: "Money", href: "/provider/money", match: ["/provider/money"], phoneTab: true },
  { id: "stake", label: "Stake", href: "/provider/capital", match: ["/provider/capital"], phoneTab: true },
  {
    id: "account",
    label: "Account",
    href: "/provider/account",
    match: ["/provider/account", "/provider/policy-changes"],
    phoneTab: false,
  },
];

function matchesPath(pathname: string, prefix: string): boolean {
  if (prefix === "/provider") return pathname === "/provider" || pathname === "/provider/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The section a console path belongs to (longest matching prefix), or null. */
export function providerSectionFor(pathname: string): ProviderSectionId | null {
  let best: { id: ProviderSectionId; length: number } | null = null;
  for (const item of PROVIDER_NAV_ITEMS) {
    for (const prefix of item.match) {
      if (matchesPath(pathname, prefix) && (!best || prefix.length > best.length)) {
        best = { id: item.id, length: prefix.length };
      }
    }
  }
  return best?.id ?? null;
}

/** Titles for the phone top bar. Longest prefix wins. */
const PROVIDER_TITLES: Record<string, string> = {
  "/provider": "Home",
  "/provider/inbox": "Inbox",
  "/provider/bindings": "Listings",
  "/provider/bindings/new": "List a tool",
  "/provider/bindings/view": "Listing",
  "/provider/tool-requests": "Tool requests",
  "/provider/apis": "Your APIs",
  "/provider/apis/new": "Publish your API",
  "/provider/apis/view": "Your API",
  "/provider/call-disputes": "Bad-result reports",
  "/provider/call-disputes/view": "Report",
  "/provider/portfolio": "Portfolio",
  "/provider/penalties": "Penalties",
  "/provider/money": "Money",
  "/provider/capital": "Stake",
  "/provider/account": "Account",
  "/provider/policy-changes": "Policy changes",
};

export function providerTitleFor(pathname: string): string {
  if (PROVIDER_TITLES[pathname]) return PROVIDER_TITLES[pathname];
  const match = Object.keys(PROVIDER_TITLES)
    .filter((href) => href !== "/provider" && pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return PROVIDER_TITLES[match];
  const section = providerSectionFor(pathname);
  return PROVIDER_NAV_ITEMS.find((item) => item.id === section)?.label ?? "Assay";
}

/**
 * The business explainer: how a provider earns, what stake is and how much a
 * penalty can take. It is the setup page's last screen, which stays reachable
 * after setup from the rail, Home and Account.
 */
export const PROVIDER_EXPLAINER = { label: "How earning, stake and penalties work", href: "/provider/setup" } as const;

/** Every href the provider chrome links to. */
export function allProviderNavHrefs(): string[] {
  return [...PROVIDER_NAV_ITEMS.map((item) => item.href), PROVIDER_EXPLAINER.href];
}

/** The tabs of the Listings section: your listings of catalogue tools, your APIs, and tool requests. */
export const PROVIDER_TOOLS_TABS: readonly SectionTab[] = [
  { id: "listings", label: "Listings", href: "/provider/bindings", match: ["/provider/bindings"] },
  { id: "apis", label: "Your APIs", href: "/provider/apis", match: ["/provider/apis"] },
  { id: "requests", label: "Tool requests", href: "/provider/tool-requests", match: ["/provider/tool-requests"] },
];

/** The tabs of the Penalties section: penalties on your stake, and buyers' reports about bad results. */
export const PROVIDER_PENALTIES_TABS: readonly SectionTab[] = [
  { id: "penalties", label: "Penalties", href: "/provider/penalties", match: ["/provider/penalties"] },
  { id: "reports", label: "Bad-result reports", href: "/provider/call-disputes", match: ["/provider/call-disputes"] },
];
