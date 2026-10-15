import type { OverrideLogEntry } from "@/interfaces/operator";
import { routes } from "@/libs/routes";

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
  "S-11": "opened a fleet sweep from",
  "S-13": "ruled on",
};

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

function fallbackTarget(entry: Pick<OverrideLogEntry, "targetType" | "targetId">): string {
  switch (entry.targetType) {
    case "slash_proposal":
      return "a penalty";
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

export function activitySentence(entry: OverrideLogEntry, names: ActivityNames): ActivitySentence {
  return {
    actor: names.operator(entry.actorSubject),
    verb: VERBS[entry.code] ?? entry.label.toLowerCase(),
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
