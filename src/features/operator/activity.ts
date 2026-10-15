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

export type ActivityKind = "all" | "blocks" | "penalties" | "operators" | "arbiter";

export const ACTIVITY_KINDS: readonly { id: ActivityKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "blocks", label: "Blocks" },
  { id: "penalties", label: "Penalties" },
  { id: "operators", label: "Team" },
  { id: "arbiter", label: "Arbiter" },
];

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

/** Whether a row belongs to a kind — applied on the client too, since "arbiter" has no target type. */
export function isOfKind(entry: Pick<OverrideLogEntry, "code" | "action" | "targetType">, kind: ActivityKind): boolean {
  if (kind === "all") return true;
  if (kind === "arbiter") return ARBITER_CODES.has(entry.code) || entry.action.startsWith("arbiter");
  return entry.targetType === targetTypeOf(kind);
}

const VERBS: Readonly<Record<string, string>> = {
  "A-9": "blocked",
  "A-10": "lifted the block on",
  "A-11": "blocked on chain",
  "A-12": "added",
  "A-13": "changed the access of",
  "A-14": "removed",
  "S-1": "suspended",
  "S-5": "recorded a compensation for",
  "S-11": "opened a bulk decision from",
  "S-13": "ruled on",
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
export type ActivityIcon = "block" | "unblock" | "chain" | "suspend" | "ruling" | "money" | "team" | "other";

export function activityIcon(entry: Pick<OverrideLogEntry, "code">): ActivityIcon {
  switch (entry.code) {
    case "A-9":
      return "block";
    case "A-10":
      return "unblock";
    case "A-11":
      return "chain";
    case "S-1":
    case "S-11":
      return "suspend";
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
 * Entries grouped by the reader's local day, newest first as given. `dayOf`
 * turns a timestamp into the group's key and label (the page passes the
 * browser's zone; tests pass a fixed one). Pure.
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
    default:
      return entry.targetType.replace(/_/g, " ");
  }
}

export function activityHref(entry: Pick<OverrideLogEntry, "targetType" | "targetId">): string | null {
  switch (entry.targetType) {
    case "slash_proposal":
      return routes.operatorCase(entry.targetId);
    case "account_block":
      return "/operator/blocks";
    case "operator":
      return "/operator/operators";
    default:
      return null;
  }
}

function verbOf(entry: OverrideLogEntry): string {
  const ruling = rulingOf(entry);
  if (ruling === "UPHOLD") return "upheld";
  if (ruling === "CANCEL") return "cancelled";
  return VERBS[entry.code] ?? entry.label.toLowerCase();
}

export function activitySentence(entry: OverrideLogEntry, names: ActivityNames): ActivitySentence {
  return {
    actor: names.operator(entry.actorSubject),
    verb: verbOf(entry),
    target: names.target(entry) ?? fallbackTarget(entry),
    reason: entry.reasonCode ? reasonLabel(entry.reasonCode) : null,
    approver: entry.approverSubject ? names.operator(entry.approverSubject) : null,
    href: activityHref(entry),
  };
}

/** The sentence as plain text (for tests and screen readers). */
export function activityText(sentence: ActivitySentence): string {
  return `${sentence.actor} ${sentence.verb} ${sentence.target}${sentence.reason ? ` (${sentence.reason})` : ""}${
    sentence.approver ? `, approved by ${sentence.approver}` : ""
  }.`;
}
