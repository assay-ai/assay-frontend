import type { OverrideLogEntry } from "@/interfaces/operator";
import { routes } from "@/libs/routes";

import { RULING_REASONS } from "./arbiter";
import { walletLabel } from "./block-targets";
import { reasonLabel } from "./reasons";

/**
 * The override register, read as sentences ("Jordan blocked Wallet 0x9f3C…F36c
 * (Leaked key), approved by Dan") with a link to what it was about. Pure, so
 * the wording is tested.
 */

export type ActivityKind = "all" | "blocks" | "penalties" | "operators" | "arbiter" | "tools" | "contracts";

export const ACTIVITY_KINDS: readonly { id: ActivityKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "blocks", label: "Blocks" },
  { id: "penalties", label: "Penalties" },
  { id: "operators", label: "Team" },
  { id: "arbiter", label: "Arbiter" },
  { id: "tools", label: "Tools" },
  { id: "contracts", label: "Contracts" },
];

/**
 * Why "Contracts" lists nothing: the contracts' settings (dispute window,
 * fees, arbiter, pause) are changed by the admin key on chain, not through an
 * operator action, so the register never holds them. The chip says where they live.
 */
export const CONTRACTS_NOT_HERE =
  "Contract settings (dispute window, fees, arbiter, pause) are changed by the admin key on chain, not through this console, so they are not in Activity. Each change is a transaction of the contracts: open Contracts and follow Explorer.";

/** The server-side `targetType` filter a kind maps to, when it maps to one. */
export function targetTypeOf(kind: ActivityKind): string | undefined {
  switch (kind) {
    case "blocks":
      return "account_block";
    case "penalties":
      return "slash_proposal";
    case "operators":
      return "operator";
    default:
      return undefined;
  }
}

const ARBITER_CODES = new Set(["S-13", "A-11"]);

/** Provider tools, tool sets, public names, their reports and cutoffs, and standard tool versions. */
const TOOL_TARGETS = new Set(["tool", "toolset", "handle", "moderation_cutoff", "toolset_report"]);

/** Whether a row belongs to a kind — applied on the client too, since "arbiter" and "tools" have no one target type. */
export function isOfKind(entry: Pick<OverrideLogEntry, "code" | "action" | "targetType">, kind: ActivityKind): boolean {
  if (kind === "all") return true;
  if (kind === "arbiter") return ARBITER_CODES.has(entry.code) || entry.action.startsWith("arbiter");
  if (kind === "tools") return TOOL_TARGETS.has(entry.targetType) || /^P-1[0-2]$/.test(entry.code);
  if (kind === "contracts") return false;
  return entry.targetType === targetTypeOf(kind);
}

/*
  S-13 and A-11 are logged when the call is BUILT (operator.service: "Builds
  and logs; the case moves when the arbiter's transaction lands"), not when it
  lands. So their verbs say "prepared", and `pending` says nothing changed on
  chain from this entry alone (operator review 2026-10-16b, P0-3): a ruling
  downloaded and never signed must not read as done.
*/
const VERBS: Readonly<Record<string, string>> = {
  "A-2": "paused or suspended the binding",
  "A-9": "blocked",
  "A-10": "lifted the block on",
  "A-11": "prepared the on-chain block of",
  "A-12": "added",
  "A-13": "changed the access of",
  "A-14": "removed",
  "A-15": "delisted",
  "A-16": "took down",
  "A-17": "took down the public name",
  "A-18": "confirmed the cutoff of",
  "A-19": "reverted the cutoff of",
  "A-20": "relisted",
  "A-21": "renamed the public name",
  "A-22": "reassigned the public name",
  "A-23": "resolved a report about",
  "A-24": "decided the catalogue review of",
  "A-25": "took down",
  "P-10": "published a version of",
  "P-11": "moved the default version of",
  "P-12": "deprecated a major of",
  "S-2": "cancelled the attestation of",
  "S-5": "recorded the pay-back of",
  "S-13": "prepared a ruling on",
  "S-14": "decided the call dispute on",
  "V-3": "removed strikes from",
  "V-5": "forced full sampling on",
  "V-7": "changed the verified label of",
};

/** The caveat of an entry logged when a transaction was built: it takes effect only once signed and landed. */
const PENDING: Readonly<Record<string, string>> = {
  "A-11": "file for the arbiter's signature; blocked on chain only once it lands",
  "S-13": "file for the arbiter's signature; takes effect only once it lands (see the penalty for its state)",
};

/**
 * An arbiter ruling's outcome: the entry's own `after.ruling` (what the
 * backend logs with `S-13`), else the function it built, else the reason —
 * each ruling reason belongs to one side only. Null when none of them says.
 */
export function rulingOf(entry: Pick<OverrideLogEntry, "code" | "after" | "reasonCode">): "UPHOLD" | "CANCEL" | null {
  if (entry.code !== "S-13") return null;
  const after = entry.after ?? {};
  const ruling = typeof after.ruling === "string" ? after.ruling.toUpperCase() : null;
  if (ruling === "UPHOLD" || ruling === "CANCEL") return ruling;
  if (after.functionName === "upholdSlashBatch") return "UPHOLD";
  if (after.functionName === "cancelSlashBatch") return "CANCEL";
  const code = entry.reasonCode;
  if (!code || code === "OTHER") return null;
  if (RULING_REASONS.UPHOLD.some((r) => r.value === code)) return "UPHOLD";
  if (RULING_REASONS.CANCEL.some((r) => r.value === code)) return "CANCEL";
  return null;
}

/** What kind of action an entry is, for its icon. */
export type ActivityIcon = "block" | "unblock" | "chain" | "ruling" | "money" | "team" | "other";

export function activityIcon(entry: Pick<OverrideLogEntry, "code">): ActivityIcon {
  switch (entry.code) {
    case "A-16":
    case "A-17":
    case "A-25":
      return "block";
    case "A-9":
      return "block";
    case "A-10":
      return "unblock";
    case "A-11":
      return "chain";
    case "S-13":
      return "ruling";
    case "S-5":
      return "money";
    case "A-12":
    case "A-13":
    case "A-14":
      return "team";
    default:
      return "other";
  }
}

/**
 * Entries grouped by day, newest first as given. `dayOf` turns a timestamp
 * into the group's key and label (the page passes `utcDay`, the UTC day). Pure.
 */
export function groupByDay<T extends Pick<OverrideLogEntry, "createdAt">>(
  rows: readonly T[],
  dayOf: (iso: string) => { key: string; label: string },
): { key: string; label: string; rows: T[] }[] {
  const groups: { key: string; label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const day = dayOf(row.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === day.key) last.rows.push(row);
    else groups.push({ ...day, rows: [row] });
  }
  return groups;
}

/** Only the entries this operator took (as the actor, not as the approver). */
export function byActor<T extends Pick<OverrideLogEntry, "actorSubject">>(rows: readonly T[], subject: string): T[] {
  return rows.filter((row) => row.actorSubject === subject);
}

export interface ActivityNames {
  /** `jordan@` → "Jordan Blake". */
  operator: (subject: string | null | undefined) => string;
  /** The words for the target, e.g. "Wallet 0x9f3C…F36c", "Riley Brooks"; null when unknown. */
  target: (entry: Pick<OverrideLogEntry, "targetType" | "targetId">) => string | null;
}

export interface ActivitySentence {
  actor: string;
  verb: string;
  target: string;
  reason: string | null;
  approver: string | null;
  href: string | null;
  /** For an entry logged when a transaction was built: what it does not mean yet. */
  pending: string | null;
}

function fallbackTarget(entry: Pick<OverrideLogEntry, "targetType" | "targetId"> & { after?: Record<string, unknown> }): string {
  switch (entry.targetType) {
    case "slash_record_batch": {
      // An arbiter ruling: the batch is not a record of its own, the penalties in it are.
      const ids = entry.after?.requestIds;
      const count = Array.isArray(ids) ? ids.length : 0;
      return count > 1 ? `${count} disputed penalties` : "a disputed penalty";
    }
    case "chain_blocklist":
      return typeof entry.after?.account === "string" ? walletLabel(entry.after.account) : "a wallet";
    case "slash_proposal":
      return `penalty ${entry.targetId.length > 12 ? `${entry.targetId.slice(0, 8)}…` : entry.targetId}`;
    case "account_block":
      return "an account";
    case "operator":
      return "an operator";
    case "tool":
      return typeof entry.after?.name === "string" ? entry.after.name : "a tool";
    case "toolset":
      return "a tool set";
    case "handle":
      return `@${entry.targetId}`;
    case "moderation_cutoff":
      return "a takedown";
    case "toolset_report":
      return "a report";
    case "call_dispute":
      return "a buyer's call";
    case "provider":
      return "a provider";
    default:
      return entry.targetType.replace(/_/g, " ");
  }
}

/**
 * Where a row's target lives. A block opens the Blocks list filtered to it
 * (`?q=` its id, `?show=lifted` once lifted); an operator, their Team row.
 */
export function activityHref(
  entry: Pick<OverrideLogEntry, "targetType" | "targetId">,
  block?: { active: boolean } | null,
): string | null {
  switch (entry.targetType) {
    case "slash_proposal":
      return routes.operatorCase(entry.targetId);
    case "account_block":
      return `/operator/blocks?q=${encodeURIComponent(entry.targetId)}${block && !block.active ? "&show=lifted" : ""}`;
    case "operator":
      return `/operator/operators#operator-${encodeURIComponent(entry.targetId)}`;
    case "tool":
      return routes.operatorTool(entry.targetId);
    case "moderation_cutoff":
      return "/operator/tools/takedowns";
    case "call_dispute":
      return routes.operatorCallDispute(entry.targetId);
    default:
      return null;
  }
}

/** A past-tense verb for every register code; an unknown code says "acted on", never its label. */
function verbOf(entry: OverrideLogEntry): string {
  const ruling = rulingOf(entry);
  if (ruling === "UPHOLD") return "prepared an uphold of";
  if (ruling === "CANCEL") return "prepared a cancel of";
  const after = entry.after ?? {};
  if (entry.code === "A-24" && typeof after.decision === "string") {
    return after.decision.toUpperCase().startsWith("APPROV") ? "approved for the catalogue" : "turned down for the catalogue";
  }
  return VERBS[entry.code] ?? "acted on";
}

export function activitySentence(entry: OverrideLogEntry, names: ActivityNames & { block?: (id: string) => { active: boolean } | null }): ActivitySentence {
  return {
    actor: names.operator(entry.actorSubject),
    verb: verbOf(entry),
    target: names.target(entry) ?? fallbackTarget(entry),
    reason: entry.reasonCode ? reasonLabel(entry.reasonCode) : null,
    approver: entry.approverSubject ? names.operator(entry.approverSubject) : null,
    href: activityHref(entry, entry.targetType === "account_block" ? names.block?.(entry.targetId) : null),
    pending: PENDING[entry.code] ?? null,
  };
}

/** The sentence as plain text (for tests and screen readers). */
export function activityText(sentence: ActivitySentence): string {
  return `${sentence.actor} ${sentence.verb} ${sentence.target}${sentence.reason ? ` (${sentence.reason})` : ""}${
    sentence.approver ? `, approved by ${sentence.approver}` : ""
  }${sentence.pending ? `: ${sentence.pending}` : ""}.`;
}
