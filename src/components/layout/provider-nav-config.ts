/**
 * The provider console's navigation — one file, so the sidebar, the phone
 * tab bar, the mobile title and the tests agree about where a page lives.
 *
 *   Home        /provider                     (Get listed checklist until live)
 *   Inbox       /provider/inbox
 *   Tools       /provider/bindings            your listings; a binding's pages; tool requests
 *   Penalties   /provider/penalties           badge = penalties that need you
 *   Money       /provider/money
 *   Stake       /provider/capital             withdraw stake is a sheet here
 *   Account     /provider/account             policy changes sit under it
 *
 * Retired URLs (listing-path, register, exit, disputes, capital/penalties,
 * the minimal-shell duplicates, a binding's old tabs) are client redirects to
 * the page that replaced them, so old links and bookmarks still land.
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
    label: "Tools",
    href: "/provider/bindings",
    match: ["/provider/bindings", "/provider/tool-requests", "/provider/portfolio", "/provider/agent-traffic"],
    phoneTab: true,
  },
  {
    id: "penalties",
    label: "Penalties",
    href: "/provider/penalties",
    match: ["/provider/penalties", "/provider/capital/penalties", "/provider/cases", "/provider/disputes"],
    phoneTab: true,
  },
  { id: "money", label: "Money", href: "/provider/money", match: ["/provider/money"], phoneTab: true },
  { id: "stake", label: "Stake", href: "/provider/capital", match: ["/provider/capital", "/provider/stake", "/provider/exit"], phoneTab: true },
  {
    id: "account",
    label: "Account",
    href: "/provider/account",
    match: ["/provider/account", "/provider/policy-changes", "/provider/register"],
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
  "/provider/bindings": "Tools",
  "/provider/bindings/new": "List a tool",
  "/provider/bindings/view": "Tool",
  "/provider/tool-requests": "Tool requests",
  "/provider/portfolio": "Portfolio",
  "/provider/penalties": "Penalties",
  "/provider/money": "Money",
  "/provider/money/reconciliation": "Reconciliation",
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

/** Every href the provider chrome links to. */
export function allProviderNavHrefs(): string[] {
  return PROVIDER_NAV_ITEMS.map((item) => item.href);
}
