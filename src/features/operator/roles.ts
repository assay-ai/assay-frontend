import type { Money } from "@/interfaces/api";
import type { OperatorDirectoryEntry, OperatorRole } from "@/interfaces/operator";
import { formatMoney } from "@/utils/money";

import { APPROVER_ROLES } from "./approvals";
import { ARBITER_BLOCK_ROLES, ARBITER_RULING_ROLES } from "./arbiter";
import { BLOCK_ROLES } from "./blocks";
import { ROLE_OPTIONS } from "./directory";
import { mayDecideCallDisputes } from "./provider-tool-review";

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
  /** At most 8 words, for the role picker: "Blocks accounts in an incident". */
  short: string;
  /** The full list, from `roleDescription`: under "What exactly?". */
  description: string;
  roles: readonly OperatorRole[];
}

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
  "S-11": "bulk decisions",
  "S-5": "provider compensations",
  "A-10": "lifting account blocks",
  "A-11": "on-chain blocks",
  "A-12": "new operators",
  "A-13": "raised roles and limits",
  "A-14": "admin removals",
  "P-10": "new standard tool versions",
  "P-11": "which tool version agents get by default",
});

const APPROVES = Object.entries(APPROVER_ROLES).map(([code, roles]) => ({
  code,
  roles,
  what: APPROVAL_WHAT[code] ?? code,
}));

const SUSPEND_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL", "SRE"];
const COMPENSATE_ROLES: readonly OperatorRole[] = ["ADJL", "TRE"];
const ADMIN_ROLES: readonly OperatorRole[] = ["OPS_ADMIN"];

function holds(roles: readonly OperatorRole[], allowed: readonly OperatorRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

/**
 * Whether these roles can take any action on money (suspend, compensate) —
 * the only ones an authority limit applies to. Team shows "—" as the limit
 * of everyone else: an admin's "$0 limit" says nothing.
 */
export function actsOnMoney(roles: readonly OperatorRole[]): boolean {
  return holds(roles, SUSPEND_ROLES) || holds(roles, COMPENSATE_ROLES);
}

// ── One capability check for every screen ───────────────────────────────────

/**
 * Everything an operator might start. The Home banner, the buttons on each
 * screen and the "Why you can't, and who can" lines all read `checkAction`,
 * so the banner can never promise an action a screen then hides.
 */
export type ConsoleAction = "rule" | "suspend" | "block" | "blockOnChain" | "compensate" | "manageTeam";

const ACTION_ROLES: Readonly<Record<ConsoleAction, readonly OperatorRole[]>> = {
  rule: ARBITER_RULING_ROLES,
  suspend: SUSPEND_ROLES,
  block: BLOCK_ROLES,
  blockOnChain: ARBITER_BLOCK_ROLES,
  compensate: COMPENSATE_ROLES,
  manageTeam: ADMIN_ROLES,
};

/** What the action is, as a verb phrase: "suspend a penalty". */
export const ACTION_WHAT: Readonly<Record<ConsoleAction, string>> = {
  rule: "rule on disputed penalties",
  suspend: "suspend a penalty",
  block: "block an account",
  blockOnChain: "block a wallet on chain",
  compensate: "compensate a provider",
  manageTeam: "add and change operators",
};

/** The action as a subject, for the one-line why-not: "Blocking accounts needs …". */
export const ACTION_DOING: Readonly<Record<ConsoleAction, string>> = {
  rule: "Ruling on disputes",
  suspend: "Suspending a penalty",
  block: "Blocking accounts",
  blockOnChain: "Blocking a wallet on chain",
  compensate: "Compensating a provider",
  manageTeam: "Changing the team",
};

/** Actions on money: the authority limit applies (the backend refuses above it). */
export const MONEY_ACTIONS: ReadonlySet<ConsoleAction> = new Set(["suspend", "compensate"]);

export interface ActionCheck {
  allowed: boolean;
  /** Why not, as one sentence. Null when allowed. */
  why: string | null;
  /** The roles that may take it. */
  roles: readonly OperatorRole[];
  /** True when the role is right and only the limit is in the way. */
  limitOnly: boolean;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function aboveLimit(limit: Money | null | undefined, amount: string): boolean {
  if (!limit) return false;
  if (!/^\d+$/.test(limit.amount) || !/^\d+$/.test(amount)) return false;
  return BigInt(amount) > BigInt(limit.amount);
}

/**
 * May this operator take `action` — on `amount` when it is about money? The
 * role comes first, then the authority limit: a $0 limit rules out every
 * action on money, whatever the role says.
 */
export function checkAction(
  identity: { roles: readonly OperatorRole[]; authorityLimit?: Money | null },
  action: ConsoleAction,
  amount?: Money | null,
): ActionCheck {
  const roles = ACTION_ROLES[action];
  if (!holds(identity.roles, roles)) {
    return { allowed: false, why: `${capitalise(ACTION_WHAT[action])} needs ${rolesPhrase(roles)}.`, roles, limitOnly: false };
  }
  if (MONEY_ACTIONS.has(action) && identity.authorityLimit) {
    const limit = identity.authorityLimit;
    if (limit.amount === "0") {
      return { allowed: false, why: `Your authority limit is $0, so you cannot ${ACTION_WHAT[action]}.`, roles, limitOnly: true };
    }
    if (amount && aboveLimit(limit, amount.amount)) {
      return {
        allowed: false,
        why: `It is ${formatMoney(amount)}, above your authority limit of ${formatMoney(limit)}.`,
        roles,
        limitOnly: true,
      };
    }
  }
  return { allowed: true, why: null, roles, limitOnly: false };
}

/**
 * Who could take `action` instead: active operators who pass the same check,
 * other than `exceptId`. Names as the console shows them.
 */
export function whoCan(
  action: ConsoleAction,
  operators: readonly Pick<OperatorDirectoryEntry, "id" | "roles" | "status" | "displayName" | "subject" | "authorityLimit">[],
  options: { amount?: Money | null; exceptId?: string | null } = {},
): string[] {
  return operators
    .filter((op) => op.status === "ACTIVE" && op.id !== options.exceptId && checkAction(op, action, options.amount).allowed)
    .map((op) => op.displayName?.trim() || op.subject);
}

export interface Capabilities {
  /** Register codes this operator may approve. */
  approveCodes: string[];
  /** "lifting account blocks, suspensions of upheld penalties" */
  approves: string[];
  /** Other things they may start, in words — only what `checkAction` allows. */
  can: string[];
  rule: boolean;
  block: boolean;
  blockOnChain: boolean;
  manageOperators: boolean;
}

const BANNER_ACTIONS: readonly ConsoleAction[] = ["rule", "suspend", "block", "compensate", "manageTeam"];

/**
 * What a set of roles (and, when given, an authority limit) lets someone do.
 * With a limit, the money actions it rules out are left out of `can`.
 */
export function capabilitiesFor(roles: readonly OperatorRole[], authorityLimit?: Money | null): Capabilities {
  const approving = APPROVES.filter((row) => holds(roles, row.roles));
  const identity = { roles, authorityLimit };
  return {
    approveCodes: approving.map((row) => row.code),
    approves: [...new Set(approving.map((row) => row.what))],
    can: BANNER_ACTIONS.filter((action) => checkAction(identity, action).allowed).map((action) => ACTION_WHAT[action]),
    rule: holds(roles, ARBITER_RULING_ROLES),
    block: holds(roles, BLOCK_ROLES),
    blockOnChain: holds(roles, ARBITER_BLOCK_ROLES),
    manageOperators: roles.includes("OPS_ADMIN"),
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
      ? `Nobody else holds the ${who} role, so nobody could approve ${serialList(whats, "or")}.`
      : `Only one other ${who} would be left, so their own requests for ${serialList(whats, "and")} could not be approved.`,
  );
}

/** "a and b", "a, b, and c": a serial comma once a listed item may hold its own "and". */
function serialList(items: readonly string[], joiner: "and" | "or"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${joiner} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${joiner} ${items[items.length - 1]}`;
}

/** Each action in the third person, for a role card. */
const ACTION_DOES: Readonly<Record<ConsoleAction, string>> = {
  rule: "prepares arbiter rulings on disputed penalties (the arbiter key signs)",
  suspend: "suspends penalties",
  block: "blocks accounts",
  blockOnChain: "blocks wallets on chain",
  compensate: "compensates providers",
  manageTeam: "adds, changes and removes operators",
};

/** The approvals, short, for a role card. */
const APPROVAL_SHORT: Readonly<Record<string, string>> = {
  "S-1": "suspensions",
  "S-11": "bulk decisions",
  "S-5": "compensations",
  "A-10": "block lifts",
  "A-11": "on-chain blocks",
  "A-12": "new operators",
  "A-13": "raised roles and limits",
  "A-14": "admin removals",
};

function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * A role set in a few short sentences — "Blocks accounts. Suspends penalties
 * up to its limit (none at $0)." — from the same role tables `checkAction` reads
 * and the approver table. The limit is picked separately, so actions on money
 * say "up to its limit (none at $0)", as the Home banner then says. Pure.
 */
export function roleDescription(roles: readonly OperatorRole[]): string {
  const allowed = BANNER_ACTIONS.filter((action) => holds(roles, ACTION_ROLES[action]));
  const plain = allowed.filter((action) => !MONEY_ACTIONS.has(action)).map((action) => ACTION_DOES[action]);
  const money = allowed.filter((action) => MONEY_ACTIONS.has(action)).map((action) => ACTION_DOES[action]);
  const approves = [...new Set(APPROVES.filter((row) => holds(roles, row.roles)).map((row) => APPROVAL_SHORT[row.code] ?? row.what))];
  // Buyer call disputes are decided here, by an operator; penalty disputes are
  // ruled by the arbiter key ("rule" above): two different "disputes".
  if (mayDecideCallDisputes(roles)) plain.unshift("decides buyer call disputes (large refunds need a second operator)");
  const parts = [
    ...(plain.length > 0 ? [sentence(listPhrase(plain))] : []),
    ...(money.length > 0 ? [sentence(`${listPhrase(money)} up to its limit (none at $0)`)] : []),
    ...(approves.length > 0 ? [sentence(`approves ${listPhrase(approves)}`)] : []),
  ];
  return parts.length > 0 ? parts.join(" ") : "Reads every screen.";
}

/**
 * What an admin picks when adding someone. Fine-grained roles sit under
 * "Customize". `short` is the line in the picker; `description` is
 * `roleDescription(roles)` — the same check the Home banner and every button
 * read — so the full list can never promise what the console then refuses.
 * A test holds each `short` to that list.
 */
export const ROLE_PRESETS: readonly RolePreset[] = Object.freeze(
  (
    [
      { id: "lead", label: "Lead adjudicator", short: "Decides call disputes, prepares arbiter rulings, blocks accounts", roles: ["ADJL"] },
      { id: "adjudicator", label: "Adjudicator", short: "Decides buyer call disputes; suspends penalties", roles: ["ADJ"] },
      { id: "support", label: "Support / on-call", short: "Blocks accounts; suspends penalties within a limit", roles: ["SRE", "SUP"] },
      { id: "treasury", label: "Treasury", short: "Prepares arbiter rulings (arbiter key signs); compensates providers", roles: ["TRE"] },
      { id: "admin", label: "Admin", short: "Adds and changes who is on the team", roles: ["OPS_ADMIN"] },
    ] as const
  ).map((preset) => ({ ...preset, roles: [...preset.roles] as OperatorRole[], description: roleDescription([...preset.roles]) })),
);
