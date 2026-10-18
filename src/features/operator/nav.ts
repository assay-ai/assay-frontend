import type { OperatorRole } from "@/interfaces/operator";

import { capabilitiesFor } from "./roles";

/**
 * The operator console's navigation — one list, so the top bar and the
 * bottom tab bar cannot disagree. Items an operator cannot use are left out
 * rather than shown and refused.
 *
 *   Home       /operator                 the "Needs you" inbox (+ Approvals)
 *   Penalties  /operator/cases           open penalties; a case at /operator/cases/view?id=
 *   Blocks     /operator/blocks
 *   Arbiter    /operator/arbiter         only for roles that can rule or block on chain
 *   Tools      /operator/tools           standard tool contracts; a tool at /operator/tools/view?id= (Policy roles only)
 *   Team       /operator/operators
 *   Contracts  /operator/contracts       the contracts' admin settings, only for Admin
 *   Activity   /operator/override-log    the override register, as sentences
 */
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
  { id: "penalties", label: "Penalties", href: "/operator/cases", match: ["/operator/cases"] },
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
    // The contract editor is the Policy roles' screen; nobody else has anything to do there.
    if (item.id === "tools") return roles.some((role) => role === "POL" || role === "POLA");
    return true;
  });
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
  const id = activeOperatorNav(pathname);
  return OPERATOR_NAV_ITEMS.find((item) => item.id === id)?.label ?? "Operator";
}
