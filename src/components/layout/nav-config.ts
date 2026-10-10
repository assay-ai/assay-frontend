/**
 * The buyer shell's navigation, and the one place that says which chrome
 * shows which item at which width.
 *
 * Three chromes cover the widths, and the union of what they reach must be
 * every section at every width (`nav-config.test.ts` asserts it):
 *
 *  - below `md` (768): the bottom tab bar shows `MOBILE_TAB_IDS` plus "More";
 *    "More" is /settings, which lists the rest (`mobileMoreItems`), and the
 *    mobile top bar carries the account menu.
 *  - from `md`: the top bar shows the first `tier` groups of items inline and
 *    puts the others behind its own "More" menu.
 *  - from `desktop` (1440): everything is inline, no "More".
 *
 * The CSS in `TopBar` mirrors `TOP_BAR_TIERS` through literal class names
 * (Tailwind cannot see a computed one); keep the two in step.
 */

export interface BuyerNavItem {
  id: string;
  label: string;
  href: string;
}

/** Widths (px) at which each tier of top-bar items becomes inline. */
export const TOP_BAR_TIERS = [768, 834, 1100, 1440] as const;
export type NavTier = 0 | 1 | 2 | 3;

/** Width below which the bottom tab bar replaces the top bar. */
export const MOBILE_MAX_WIDTH = 767;

export const BUYER_NAV_ITEMS: (BuyerNavItem & { tier: NavTier })[] = [
  { id: "overview", label: "Overview", href: "/", tier: 0 },
  { id: "spend", label: "Spend", href: "/spend", tier: 0 },
  { id: "guarantee", label: "Guarantee", href: "/guarantee", tier: 1 },
  { id: "funding", label: "Funding", href: "/funding", tier: 2 },
  { id: "limits", label: "Limits", href: "/limits", tier: 2 },
  { id: "approvals", label: "Approvals", href: "/approvals", tier: 3 },
  { id: "explore", label: "Explore", href: "/explore/providers", tier: 3 },
  { id: "agents", label: "Agents", href: "/agents", tier: 3 },
];

/** Items with a slot of their own in the bottom tab bar. */
export const MOBILE_TAB_IDS: readonly string[] = ["overview", "spend", "funding", "limits"];

/** Items the mobile "More" screen (/settings) has to list. */
export function mobileMoreItems(): BuyerNavItem[] {
  return BUYER_NAV_ITEMS.filter((item) => !MOBILE_TAB_IDS.includes(item.id));
}

/** Which items the top bar shows inline, and which sit behind "More", at a width (>= 768). */
export function topBarPlacement(width: number): { inline: BuyerNavItem[]; overflow: BuyerNavItem[] } {
  const inline: BuyerNavItem[] = [];
  const overflow: BuyerNavItem[] = [];
  for (const item of BUYER_NAV_ITEMS) {
    (width >= TOP_BAR_TIERS[item.tier] ? inline : overflow).push(item);
  }
  return { inline, overflow };
}

/** Every section reachable from the nav chrome at a width. */
export function reachableNavIds(width: number): string[] {
  if (width <= MOBILE_MAX_WIDTH) {
    return [...MOBILE_TAB_IDS, ...mobileMoreItems().map((item) => item.id)];
  }
  const { inline, overflow } = topBarPlacement(width);
  return [...inline, ...overflow].map((item) => item.id);
}
