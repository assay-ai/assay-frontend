/**
 * The buyer shell's navigation — five sections, their in-section tabs, and
 * the account menu. One file, so the top bar, the bottom tab bar, the section
 * tabs and the account menu can never disagree about where a page lives.
 *
 *   Overview   /                       (Get started lives here for new accounts)
 *   Activity   /spend                  Spend · Calls · Not charged
 *   Money      /funding                Funding · Statements
 *   Controls   /agents                 Agents · Connect · Limits · Tool sets
 *   Explore    /explore
 *
 * Rare pages (Alerts settings, Account history, Settings, Help) sit in the
 * account menu, on desktop and on mobile alike. Team is deliberately absent:
 * it only says that an account is one person for now, so it is not a menu
 * entry. A payment link (`/payments/view`) is opened from a notification.
 *
 * Every buyer page also has a title here (`PAGE_TITLES`): the browser tab
 * names the page, and the mobile header names the section (the page's own
 * heading is right under it, so repeating it there only got cut off).
 *
 * The same five items show at every width: inline in the top bar from 768,
 * as the bottom tab bar below it. `nav-config.test.ts` asserts every route
 * named here exists and every buyer page is reachable.
 */

export type BuyerSectionId = "overview" | "activity" | "money" | "controls" | "explore";

export interface BuyerNavItem {
  id: BuyerSectionId;
  label: string;
  href: string;
  /** Path prefixes that belong to this section (for the active state). "/" matches only itself. */
  match: string[];
}

export const BUYER_NAV_ITEMS: BuyerNavItem[] = [
  { id: "overview", label: "Overview", href: "/", match: ["/", "/onboarding"] },
  {
    id: "activity",
    label: "Activity",
    href: "/spend",
    match: ["/spend", "/guarantee", "/receipts", "/payments"],
  },
  { id: "money", label: "Money", href: "/funding", match: ["/funding", "/statements"] },
  {
    id: "controls",
    label: "Controls",
    href: "/agents",
    match: ["/agents", "/limits", "/connect", "/toolsets/mine"],
  },
  { id: "explore", label: "Explore", href: "/explore", match: ["/explore"] },
];

export interface SectionTab {
  id: string;
  label: string;
  href: string;
  /** Extra paths that count as this tab (sub-pages). Defaults to `[href]`. */
  match?: string[];
  /** A count to show next to the label ("Needs you 3"). Hidden at 0. Set at render time. */
  badge?: number;
}

/** The tabs at the top of each multi-page section. */
export const BUYER_SECTION_TABS: Partial<Record<BuyerSectionId, SectionTab[]>> = {
  activity: [
    { id: "spend", label: "Spend", href: "/spend" },
    { id: "calls", label: "Calls", href: "/spend/calls", match: ["/spend/calls", "/receipts"] },
    { id: "not-charged", label: "Not charged", href: "/guarantee" },
    { id: "reports", label: "Reports", href: "/spend/disputes", match: ["/spend/disputes"] },
  ],
  money: [
    { id: "funding", label: "Funding", href: "/funding" },
    { id: "statements", label: "Statements", href: "/statements" },
  ],
  controls: [
    // Short labels: the four must fit a 390px strip without being cut.
    { id: "agents", label: "Agents", href: "/agents" },
    { id: "connect", label: "Connect", href: "/connect" },
    { id: "budgets", label: "Limits", href: "/limits" },
    { id: "toolsets", label: "Tool sets", href: "/toolsets/mine" },
  ],
};

export interface AccountMenuLink {
  id: string;
  label: string;
  href: string;
  external?: boolean;
}

/**
 * Optional public docs site. When it is not configured, "Help & docs" goes to
 * the in-app explainer rather than to a link that leads nowhere.
 */
export const DOCS_URL: string | null = process.env.NEXT_PUBLIC_DOCS_URL?.trim() || null;

/** The account (avatar) menu's links, after the wallet and balance block. */
export const ACCOUNT_MENU_LINKS: AccountMenuLink[] = [
  { id: "get-started", label: "Get started", href: "/onboarding" },
  { id: "alerts", label: "Alert settings", href: "/alerts" },
  // Not "Activity": that is the calls-and-spend section.
  { id: "audit-log", label: "Account history", href: "/audit-log" },
  { id: "settings", label: "Settings", href: "/settings" },
  DOCS_URL
    ? { id: "help", label: "Help & docs", href: DOCS_URL, external: true }
    : { id: "help", label: "Help & docs", href: "/how-it-works" },
];

function matchesPath(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The section a path belongs to, or null for pages outside the five (Settings, Alerts…). */
export function sectionFor(pathname: string): BuyerSectionId | null {
  let best: { id: BuyerSectionId; length: number } | null = null;
  for (const item of BUYER_NAV_ITEMS) {
    for (const prefix of item.match) {
      if (matchesPath(pathname, prefix) && (!best || prefix.length > best.length)) {
        best = { id: item.id, length: prefix.length };
      }
    }
  }
  return best?.id ?? null;
}

/** The active tab of a section at a path: the longest matching tab path wins. */
export function activeTabFor(tabs: readonly SectionTab[], pathname: string): string | null {
  let best: { id: string; length: number } | null = null;
  for (const tab of tabs) {
    for (const prefix of tab.match ?? [tab.href]) {
      if (matchesPath(pathname, prefix) && (!best || prefix.length > best.length)) {
        best = { id: tab.id, length: prefix.length };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Each buyer page's own name, for the browser tab ("Calls — Assay"). Record
 * pages are named after the record kind; the longest matching path wins, so
 * /spend/disputes/view is "Report" and not "Reports".
 */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/": "Overview",
  "/onboarding": "Get started",
  "/spend": "Spend",
  "/spend/calls": "Calls",
  "/spend/disputes": "Reports",
  "/spend/disputes/view": "Report",
  "/receipts/view": "Receipt",
  "/payments/view": "Payment",
  "/guarantee": "Not charged",
  "/funding": "Funding",
  "/funding/auto-top-up": "Auto top-up",
  "/statements": "Statements",
  "/agents": "Agents & keys",
  "/connect": "Connect",
  "/connect/preview": "MCP server",
  "/connect/authorize": "Connect an app",
  "/connect/authorize-error": "Connect an app",
  "/agents/enable-paid": "Turn on paid calls",
  "/limits": "Spending limits",
  "/toolsets/mine": "Tool sets",
  "/explore": "Explore",
  "/explore/providers": "Providers",
  "/explore/providers/view": "Provider",
  "/explore/toolsets": "Shared tool sets",
  "/alerts": "Alerts",
  "/audit-log": "Account history",
  "/team": "Team",
  "/settings": "Settings",
  "/settings/close": "Close account",
};

/** The page's name at a path: the longest matching entry of `PAGE_TITLES`, else null. */
export function pageTitleFor(pathname: string): string | null {
  let best: string | null = null;
  for (const prefix of Object.keys(PAGE_TITLES)) {
    if (matchesPath(pathname, prefix) && (best === null || prefix.length > best.length)) best = prefix;
  }
  return best === null ? null : PAGE_TITLES[best]!;
}

/** The browser tab's title: "Calls — Assay". */
export function documentTitleFor(pathname: string): string {
  const page = pageTitleFor(pathname);
  return page ? `${page} — Assay` : "Assay";
}

/**
 * The mobile header's title: the section ("Controls", "Activity"), because
 * the page's own heading sits right below it; a page outside the five
 * sections (Settings, Alerts…) keeps its own name.
 */
export function mobileTitleFor(pathname: string): string {
  const section = sectionFor(pathname);
  if (section) return BUYER_NAV_ITEMS.find((item) => item.id === section)!.label;
  return pageTitleFor(pathname) ?? "Assay";
}

/** Every href the buyer chrome links to (sections, tabs, account menu). */
export function allBuyerNavHrefs(): string[] {
  return [
    ...BUYER_NAV_ITEMS.map((item) => item.href),
    ...Object.values(BUYER_SECTION_TABS).flatMap((tabs) => (tabs ?? []).map((tab) => tab.href)),
    ...ACCOUNT_MENU_LINKS.filter((link) => !link.external).map((link) => link.href),
  ];
}
