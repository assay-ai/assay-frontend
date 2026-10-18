import type { OperatorRole } from "@/interfaces/operator";

import { seesTools, toolsHomeFor } from "./provider-tool-review";
import { capabilitiesFor } from "./roles";

/**
 * The operator console's navigation — one list, so the top bar and the
 * bottom tab bar cannot disagree. Items an operator cannot use are left out
 * rather than shown and refused.
 *
 *   Home       /operator                 the "Needs you" inbox (+ Approvals)
 *   Penalties  /operator/cases           open penalties; a case at /operator/cases/view?id=;
 *                                        buyers' call disputes at /operator/disputes (a tab)
 *   Blocks     /operator/blocks
 *   Arbiter    /operator/arbiter         only for roles that can rule or block on chain
 *   Tools      /operator/tools           standard tool contracts (Policy roles), provider tool
 *                                        reviews, promotions and takedowns (tabs); opens on
 *                                        the first tab this operator can use
 *   Team       /operator/operators
 *   Contracts  /operator/contracts       the contracts' admin settings, only for Admin
 *   Activity   /operator/override-log    the override register, as sentences
 */
/** Eight items at most: the phone tab bar holds eight at 390px (48px each). */
export type OperatorNavId = "home" | "penalties" | "blocks" | "arbiter" | "tools" | "team" | "contracts" | "activity";

export interface OperatorNavItem {
  id: OperatorNavId;
  label: string;
  /** The phone tab bar's label, when `label` does not fit seven tabs. */
  short?: string;
  href: string;
  /** Path prefixes that belong to this item. "/operator" matches itself and the approvals inbox. */
  match: readonly string[];
}

export const OPERATOR_NAV_ITEMS: readonly OperatorNavItem[] = Object.freeze([
  { id: "home", label: "Home", href: "/operator", match: ["/operator", "/operator/approvals"] },
  { id: "penalties", label: "Penalties", href: "/operator/cases", match: ["/operator/cases", "/operator/disputes"] },
  { id: "blocks", label: "Blocks", href: "/operator/blocks", match: ["/operator/blocks"] },
  { id: "arbiter", label: "Arbiter", href: "/operator/arbiter", match: ["/operator/arbiter"] },
  { id: "tools", label: "Tools", href: "/operator/tools", match: ["/operator/tools"] },
  { id: "team", label: "Team", href: "/operator/operators", match: ["/operator/operators"] },
  { id: "contracts", label: "Contracts", short: "Config", href: "/operator/contracts", match: ["/operator/contracts"] },
  { id: "activity", label: "Activity", href: "/operator/override-log", match: ["/operator/override-log"] },
]);

/**
 * The items this operator sees. Arbiter is left out for a role with nothing to
 * do there; Contracts is for Admin only (it is the admin key's page).
 */
export function operatorNavFor(roles: readonly OperatorRole[]): OperatorNavItem[] {
  const caps = capabilitiesFor(roles);
  return OPERATOR_NAV_ITEMS.filter((item) => {
    if (item.id === "arbiter") return caps.rule || caps.blockOnChain;
    if (item.id === "contracts") return caps.manageOperators;
    // Contracts (Policy roles), provider tool reviews (ADJ, ADJL, POL) and takedowns (ADJ, ADJL, SRE).
    if (item.id === "tools") return seesTools(roles);
    return true;
  }).map((item) => (item.id === "tools" ? { ...item, href: toolsHomeFor(roles) } : item));
}

function matches(pathname: string, prefix: string): boolean {
  if (prefix === "/operator") return pathname === "/operator" || pathname === "/operator/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`);
}

/** The active item at a path: the longest matching prefix wins. */
export function activeOperatorNav(pathname: string): OperatorNavId | null {
  let best: { id: OperatorNavId; length: number } | null = null;
  for (const item of OPERATOR_NAV_ITEMS) {
    for (const prefix of item.match) {
      if (matches(pathname, prefix) && (!best || prefix.length > best.length)) best = { id: item.id, length: prefix.length };
    }
  }
  return best?.id ?? null;
}

/** The page title on the mobile top bar. */
export function operatorTitleFor(pathname: string): string {
  if (pathname.startsWith("/operator/approvals")) return "Approvals";
  if (pathname.startsWith("/operator/cases/view")) return "Penalty";
  if (pathname.startsWith("/operator/tools/view")) return "Tool";
  if (pathname.startsWith("/operator/tools/reviews/view")) return "Review";
  if (pathname.startsWith("/operator/tools/reviews")) return "Reviews";
  if (pathname.startsWith("/operator/tools/promotions")) return "Promotions";
  if (pathname.startsWith("/operator/tools/takedowns")) return "Takedowns";
  if (pathname.startsWith("/operator/disputes/view")) return "Call dispute";
  if (pathname.startsWith("/operator/disputes")) return "Call disputes";
  const id = activeOperatorNav(pathname);
  return OPERATOR_NAV_ITEMS.find((item) => item.id === id)?.label ?? "Operator";
}
