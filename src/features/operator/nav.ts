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
 *   Team       /operator/operators
 *   Activity   /operator/override-log    the override register, as sentences
 */
export type OperatorNavId = "home" | "penalties" | "blocks" | "arbiter" | "team" | "activity";

export interface OperatorNavItem {
  id: OperatorNavId;
  label: string;
  href: string;
  /** Path prefixes that belong to this item. "/operator" matches itself and the approvals inbox. */
  match: readonly string[];
}

export const OPERATOR_NAV_ITEMS: readonly OperatorNavItem[] = Object.freeze([
  { id: "home", label: "Home", href: "/operator", match: ["/operator", "/operator/approvals"] },
  { id: "penalties", label: "Penalties", href: "/operator/cases", match: ["/operator/cases"] },
  { id: "blocks", label: "Blocks", href: "/operator/blocks", match: ["/operator/blocks"] },
  { id: "arbiter", label: "Arbiter", href: "/operator/arbiter", match: ["/operator/arbiter"] },
  { id: "team", label: "Team", href: "/operator/operators", match: ["/operator/operators"] },
  { id: "activity", label: "Activity", href: "/operator/override-log", match: ["/operator/override-log"] },
]);

/** The items this operator sees. Arbiter is the one screen with nothing to do for a read-only role. */
export function operatorNavFor(roles: readonly OperatorRole[]): OperatorNavItem[] {
  const caps = capabilitiesFor(roles);
  return OPERATOR_NAV_ITEMS.filter((item) => item.id !== "arbiter" || caps.rule || caps.blockOnChain);
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
  const id = activeOperatorNav(pathname);
  return OPERATOR_NAV_ITEMS.find((item) => item.id === id)?.label ?? "Operator";
}
