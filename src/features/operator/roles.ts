import type { OperatorRole } from "@/interfaces/operator";

import { APPROVER_ROLES } from "./approvals";
import { ARBITER_BLOCK_ROLES, ARBITER_RULING_ROLES } from "./arbiter";
import { BLOCK_ROLES } from "./blocks";
import { ROLE_OPTIONS } from "./directory";

/**
 * Operator roles in plain words: what each one is called, the presets an
 * admin picks from, and what a set of roles lets someone do. The role codes
 * (`ADJL`, `OPS_ADMIN`) stay on the wire and under "Customize"; everywhere
 * else a person reads these names.
 *
 * The capability list is derived from the same tables the screens gate on
 * (`APPROVER_ROLES`, `BLOCK_ROLES`, `ARBITER_*_ROLES`, `state.ts`), so the
 * first-run card cannot promise something a button then refuses.
 */

/** The plain name of each role — the directory's own labels, so the two never disagree. */
export const ROLE_NAME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ROLE_OPTIONS.map((option) => [option.role, option.label])),
);

/** `ADJL` → "Lead adjudicator"; an unknown code stays as it came. */
export function roleName(role: string): string {
  return ROLE_NAME[role] ?? role;
}

/** "Lead adjudicator or Treasury" — for "needs …" sentences. */
export function rolesPhrase(roles: readonly string[], join: "or" | "and" = "or"): string {
  const names = roles.map(roleName);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${join} ${names[names.length - 1]}`;
}

export interface RolePreset {
  id: string;
  label: string;
  description: string;
  roles: readonly OperatorRole[];
}

/** What an admin picks when adding someone. Fine-grained roles sit under "Customize". */
export const ROLE_PRESETS: readonly RolePreset[] = Object.freeze([
  {
    id: "lead",
    label: "Lead adjudicator",
    description: "Rules on disputes, blocks accounts, approves lifts and suspensions.",
    roles: ["ADJL"],
  },
  {
    id: "adjudicator",
    label: "Adjudicator",
    description: "Reviews penalties, suspends them, approves suspensions.",
    roles: ["ADJ"],
  },
  {
    id: "support",
    label: "Support / on-call",
    description: "Blocks accounts in an incident, suspends penalties.",
    roles: ["SRE", "SUP"],
  },
  {
    id: "treasury",
    label: "Treasury",
    description: "Rules on disputes, compensates providers, approves compensations.",
    roles: ["TRE"],
  },
  {
    id: "admin",
    label: "Admin",
    description: "Adds, changes and removes operators.",
    roles: ["OPS_ADMIN"],
  },
]);

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((role) => right.has(role));
}

/** The preset these roles are exactly, or null (a custom mix). */
export function presetOf(roles: readonly OperatorRole[]): RolePreset | null {
  return ROLE_PRESETS.find((preset) => sameSet(preset.roles, roles)) ?? null;
}

/** "Lead adjudicator", or "Lead adjudicator · Admin" for a mix. */
export function roleTitle(roles: readonly OperatorRole[]): string {
  if (roles.length === 0) return "No role";
  const preset = presetOf(roles);
  if (preset) return preset.label;
  return roles.map(roleName).join(" · ");
}

// ── What a set of roles may do ──────────────────────────────────────────────

/** What approving each register code means, in words. The roles come from `APPROVER_ROLES`. */
export const APPROVAL_WHAT: Readonly<Record<string, string>> = Object.freeze({
  "S-1": "suspensions of upheld penalties",
  "S-11": "fleet sweeps",
  "S-5": "provider compensations",
  "A-10": "lifting account blocks",
  "A-12": "new operators",
  "A-13": "raised roles and limits",
});

const APPROVES = Object.entries(APPROVER_ROLES).map(([code, roles]) => ({
  code,
  roles,
  what: APPROVAL_WHAT[code] ?? code,
}));

const SUSPEND_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL", "SRE"];
const COMPENSATE_ROLES: readonly OperatorRole[] = ["ADJL", "TRE"];

function holds(roles: readonly OperatorRole[], allowed: readonly OperatorRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export interface Capabilities {
  /** Register codes this operator may approve. */
  approveCodes: string[];
  /** "lifting account blocks, suspensions of upheld penalties" */
  approves: string[];
  /** Other things they may start, in words. */
  can: string[];
  rule: boolean;
  block: boolean;
  blockOnChain: boolean;
  manageOperators: boolean;
}

export function capabilitiesFor(roles: readonly OperatorRole[]): Capabilities {
  const approving = APPROVES.filter((row) => holds(roles, row.roles));
  const rule = holds(roles, ARBITER_RULING_ROLES);
  const block = holds(roles, BLOCK_ROLES);
  const blockOnChain = holds(roles, ARBITER_BLOCK_ROLES);
  const manageOperators = roles.includes("OPS_ADMIN");
  const can: string[] = [];
  if (rule) can.push("rule on disputed penalties");
  if (holds(roles, SUSPEND_ROLES)) can.push("suspend a penalty");
  if (block) can.push("block an account");
  if (holds(roles, COMPENSATE_ROLES)) can.push("compensate a provider");
  if (manageOperators) can.push("add and change operators");
  return {
    approveCodes: approving.map((row) => row.code),
    approves: [...new Set(approving.map((row) => row.what))],
    can,
    rule,
    block,
    blockOnChain,
    manageOperators,
  };
}

/** "a, b and c" */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What removing an operator would break: every two-person action whose
 * approvers drop below two. With one holder left, that person's own requests
 * can never be approved, and with none nobody's can.
 */
export function removalWarnings(
  operators: readonly { id: string; status: string; roles: readonly OperatorRole[] }[],
  removeId: string,
): string[] {
  const active = operators.filter((op) => op.status === "ACTIVE");
  const removed = active.find((op) => op.id === removeId);
  if (!removed) return [];
  const groups = new Map<string, { who: string; left: number; whats: string[] }>();
  for (const [code, roles] of Object.entries(APPROVER_ROLES)) {
    if (!removed.roles.some((role) => roles.includes(role))) continue;
    const left = active.filter((op) => op.id !== removeId && op.roles.some((role) => roles.includes(role))).length;
    if (left >= 2) continue;
    const who = rolesPhrase(roles);
    const key = `${who}|${left}`;
    const group = groups.get(key) ?? { who, left, whats: [] };
    group.whats.push(APPROVAL_WHAT[code] ?? code);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ who, left, whats }) =>
    left === 0
      ? `Nobody else is ${who}: ${listPhrase(whats)} could no longer be approved.`
      : `Only one other ${who} would be left: their own requests for ${listPhrase(whats)} could not be approved.`,
  );
}
