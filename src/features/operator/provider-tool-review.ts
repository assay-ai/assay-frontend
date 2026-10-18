import type { SectionTab } from "@/components/layout/nav-config";
import type { OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { CUTOFF_LATE_HOURS } from "@/libs/dispute-deadlines";
import { plainError } from "@/libs/plain-language";
import type { ModerationCutoff, ReviewChecklistItem, ReviewQueueItem } from "@/services/operator-provider-tools.service";

/**
 * The operator's side of provider tools and buyer call disputes, kept out
 * of the pages so it can be tested. Pure. Roles follow the backend's
 * override register:
 *
 *   A-24 review decision        ADJ, ADJL, POL
 *   A-25 provider tool takedown ADJ, ADJL, SRE   (confirmed by a second operator in 72 h)
 *   A-18 / A-19 confirm, revert ADJ, ADJL        (lifting a confirmed one is two-person)
 *   promotions                  POL, POLA
 *   S-14 call dispute decision  ADJ, ADJL        (an upheld refund at or above the threshold is two-person)
 */

const REVIEW_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL", "POL"];
const TAKEDOWN_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL", "SRE"];
const CONFIRM_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL"];
const PROMOTION_ROLES: readonly OperatorRole[] = ["POL", "POLA"];
const CONTRACT_ROLES: readonly OperatorRole[] = ["POL", "POLA"];
const DISPUTE_ROLES: readonly OperatorRole[] = ["ADJ", "ADJL"];

function holds(roles: readonly OperatorRole[], allowed: readonly OperatorRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export const mayReviewTools = (roles: readonly OperatorRole[]) => holds(roles, REVIEW_ROLES);
export const mayTakeDownTools = (roles: readonly OperatorRole[]) => holds(roles, TAKEDOWN_ROLES);
export const mayConfirmCutoffs = (roles: readonly OperatorRole[]) => holds(roles, CONFIRM_ROLES);
export const mayPromote = (roles: readonly OperatorRole[]) => holds(roles, PROMOTION_ROLES);
export const mayDecideCallDisputes = (roles: readonly OperatorRole[]) => holds(roles, DISPUTE_ROLES);

/** Whether the Tools section has anything for this operator. */
export function seesTools(roles: readonly OperatorRole[]): boolean {
  return holds(roles, [...CONTRACT_ROLES, ...REVIEW_ROLES, ...TAKEDOWN_ROLES]);
}

/** Where Tools opens: the contract editor for Policy roles, else the review queue (or takedowns for SRE). */
export function toolsHomeFor(roles: readonly OperatorRole[]): string {
  if (holds(roles, CONTRACT_ROLES)) return "/operator/tools";
  if (mayReviewTools(roles)) return "/operator/tools/reviews";
  return "/operator/tools/takedowns";
}

/** The tabs of Tools this operator can use. */
export function operatorToolsTabs(roles: readonly OperatorRole[]): SectionTab[] {
  const tabs: SectionTab[] = [];
  if (holds(roles, CONTRACT_ROLES)) tabs.push({ id: "standard", label: "Standard tools", href: "/operator/tools", match: ["/operator/tools"] });
  if (mayReviewTools(roles) || mayTakeDownTools(roles)) tabs.push({ id: "reviews", label: "Reviews", href: "/operator/tools/reviews", match: ["/operator/tools/reviews"] });
  if (mayPromote(roles)) tabs.push({ id: "promotions", label: "Promotions", href: "/operator/tools/promotions", match: ["/operator/tools/promotions"] });
  if (mayTakeDownTools(roles) || mayConfirmCutoffs(roles)) tabs.push({ id: "takedowns", label: "Takedowns", href: "/operator/tools/takedowns", match: ["/operator/tools/takedowns"] });
  return tabs;
}

/** The tabs of Penalties: slash cases, and buyers' disputes over calls. */
export const OPERATOR_CASES_TABS: readonly SectionTab[] = [
  { id: "penalties", label: "Penalties", href: "/operator/cases", match: ["/operator/cases"] },
  { id: "disputes", label: "Call disputes", href: "/operator/disputes", match: ["/operator/disputes"] },
];

/* ---------------------------------------------------------------- review */

export const REVIEW_KIND_LABEL: Readonly<Record<string, string>> = {
  FIRST: "First review",
  CHANGE: "Change to a listed tool",
};

export const CHECKLIST_LABEL: Readonly<Record<string, string>> = {
  NO_IMPERSONATION: "No impersonation",
  NO_MODEL_INSTRUCTIONS: "No instructions to models",
  NO_SECRET_INPUTS: "No secret inputs",
  EXAMPLES_MATCH_SCHEMA: "Examples run and match the schemas",
  PRICING_CLEAR: "Pricing is clear",
};

export interface ChecklistRow {
  item: string;
  label: string;
  verdict: "PASS" | "FAIL" | "CHECK";
  /** "Passed the screen", "Failed the screen", "You decide". */
  verdictLabel: string;
  detail: string;
  findings: ReviewChecklistItem["findings"];
}

export function checklistRows(items: readonly ReviewChecklistItem[]): ChecklistRow[] {
  return items.map((item) => ({
    item: item.item,
    label: CHECKLIST_LABEL[item.item] ?? item.item,
    verdict: item.automated,
    verdictLabel: item.automated === "PASS" ? "Passed the screen" : item.automated === "FAIL" ? "Failed the screen" : "You decide",
    detail: item.detail,
    findings: item.findings,
  }));
}

/** Approving is blocked while the screen failed an item: the provider has to fix it first. */
export function approveBlockedBy(rows: readonly ChecklistRow[], gatePassed: boolean): string | null {
  const failed = rows.filter((r) => r.verdict === "FAIL");
  if (failed.length > 0) return `Failed the screen: ${failed.map((r) => r.label.toLowerCase()).join(", ")}. Reject it with what to fix.`;
  if (!gatePassed) return "The publish checks no longer pass (endpoint test, stake or payout). Reject it, or wait for the provider to fix them.";
  return null;
}

/** The queue's order: pending first, oldest submission first. */
export function sortReviewQueue(rows: readonly ReviewQueueItem[]): ReviewQueueItem[] {
  return [...rows].sort((a, b) => {
    const pa = a.status === "PENDING" ? 0 : 1;
    const pb = b.status === "PENDING" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return Date.parse(a.submittedAt ?? a.decidedAt ?? "") - Date.parse(b.submittedAt ?? b.decidedAt ?? "");
  });
}

/** "f3b1c2d4…9e0a": the hash an approval is for, short enough to read aloud. */
export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

/** The reject reasons the API accepts: one per §7.6 checklist item (free text is refused). */
export const REJECT_REASONS = [
  { value: "IMPERSONATION", label: "Impersonation" },
  { value: "MODEL_INSTRUCTIONS", label: "Instructions to models" },
  { value: "SECRET_INPUTS", label: "Asks for secrets" },
  { value: "EXAMPLES_MISMATCH", label: "Examples don't match" },
  { value: "PRICING_UNCLEAR", label: "Pricing unclear" },
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number]["value"];

/** The reject reason each checklist item stands for. */
export const CHECKLIST_REASON: Readonly<Record<string, RejectReason>> = {
  NO_IMPERSONATION: "IMPERSONATION",
  NO_MODEL_INSTRUCTIONS: "MODEL_INSTRUCTIONS",
  NO_SECRET_INPUTS: "SECRET_INPUTS",
  EXAMPLES_MATCH_SCHEMA: "EXAMPLES_MISMATCH",
  PRICING_CLEAR: "PRICING_UNCLEAR",
};

/** The reason a rejection starts with: the first item the screen failed, or the first you marked as a problem. */
export function suggestedRejectReason(rows: readonly ChecklistRow[], problems: ReadonlySet<string>): RejectReason | "" {
  const first = rows.find((r) => r.verdict === "FAIL") ?? rows.find((r) => problems.has(r.item));
  return first ? (CHECKLIST_REASON[first.item] ?? "") : "";
}

/** "Looks fine" / "Problem" on each item the operator decides. */
export type ManualCheck = "OK" | "PROBLEM";

/**
 * Why the decision button is disabled, in one sentence; null when it can be
 * pressed. Approving needs every "You decide" item marked fine, nothing the
 * screen failed, and the publish checks passing.
 */
export function decisionBlockedBy(input: {
  decision: "APPROVE" | "REJECT" | null;
  rows: readonly ChecklistRow[];
  checks: Readonly<Record<string, ManualCheck>>;
  gatePassed: boolean;
  stale: boolean;
}): string | null {
  if (input.stale) return "The content changed: read the new content first (see the notice above).";
  if (!input.decision) return "Pick Approve or Reject first.";
  if (input.decision === "REJECT") return null;
  const screen = approveBlockedBy(input.rows, input.gatePassed);
  if (screen) return screen;
  const manual = input.rows.filter((r) => r.verdict === "CHECK");
  const problem = manual.find((r) => input.checks[r.item] === "PROBLEM");
  if (problem) return `You marked “${problem.label}” as a problem. Reject it with what to fix.`;
  const open = manual.filter((r) => input.checks[r.item] !== "OK");
  if (open.length > 0) return `Check ${open.map((r) => `“${r.label}”`).join(" and ")} in the checklist above first.`;
  return null;
}

/** What each tier tells an agent, in one line. */
export const TIER_HINT = {
  VERIFIED: "Verified: the reviewer vouches that it does what it says, and agents see a Verified badge.",
  UNVERIFIED: "Unverified: listed in the catalogue without the badge, for a tool that passes but whose answers you could not judge well.",
} as const;

export const TAKEDOWN_REASONS = [
  { value: "IMPERSONATION", label: "Impersonation" },
  { value: "MALICIOUS", label: "Malicious or harmful" },
  { value: "MODEL_INSTRUCTIONS", label: "Instructions to models" },
  { value: "LEGAL", label: "Legal request" },
  { value: "OTHER", label: "Other" },
] as const;

export const MODERATION_NOTE_MIN = 20;

/* -------------------------------------------------------------- cutoffs */

export interface CutoffView {
  label: string;
  tone: "neutral" | "warning" | "danger" | "success";
  /** Still waiting for a second operator. */
  pending: boolean;
}

export function cutoffView(cutoff: ModerationCutoff, now: number): CutoffView {
  if (cutoff.revertedAt) {
    const why: Record<string, string> = { EXPIRED: "Reverted: nobody confirmed it in 72 h", REJECTED: "Rejected by a second operator", LIFTED: "Lifted", REASSIGNED: "Reassigned" };
    return { label: why[cutoff.revertReason ?? ""] ?? "Reverted", tone: "neutral", pending: false };
  }
  if (cutoff.confirmedAt) return { label: "Confirmed", tone: "danger", pending: false };
  const late = Date.parse(cutoff.confirmBy) - now < CUTOFF_LATE_HOURS * 3_600_000;
  return { label: "Waiting for a second operator", tone: late ? "danger" : "warning", pending: true };
}

/** Confirming your own takedown is refused: say so before the click. */
export function confirmBlockedBy(cutoff: ModerationCutoff, me: { id: string; subject?: string | null }): string | null {
  if (cutoff.actedBy && (cutoff.actedBy === me.id || cutoff.actedBy === me.subject)) return "You took it down, so a different operator has to confirm it.";
  return null;
}

/* ---------------------------------------------------------------- errors */

export function toolReviewErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : "That did not work. Try again.";
  switch (error.code) {
    case "TOOL_REVIEW_STALE":
      return "The provider changed what is under review after you opened it. Nothing was decided. Reload and read the new content first.";
    case "TOOL_REVIEW_NOT_PENDING":
      return "Nothing is waiting for review on this tool any more (it was decided or withdrawn).";
    case "TOOL_PROVIDER_TOOL_STATE":
      return typeof error.context?.reason === "string" ? `Not possible now: ${String(error.context.reason)}.` : "The tool changed in the meantime. Reload it.";
    case "TOOL_PROVIDER_TOOL_NOT_FOUND":
      return "This tool no longer exists.";
    case "TOOL_PROMOTION_INVALID":
      return typeof error.context?.reason === "string" ? `It can't be promoted: ${String(error.context.reason)}.` : "It can't be promoted.";
    case "TOOL_CONTRACT_NAME_TAKEN":
      return "A tool with that name exists. Pick another name.";
    case "TOOLSET_CUTOFF_SELF_CONFIRM":
      return "You took it down, so a different operator has to confirm it.";
    case "TOOLSET_CUTOFF_NOT_PENDING":
      return "It is no longer waiting for a confirmation.";
    case "OPERATOR_ROLE_REQUIRED":
      return "Your role can't do this.";
    default:
      return plainError(error.code);
  }
}

/** A stale review: the content hash the operator read is no longer the stored one. */
export function isStaleReview(error: unknown): boolean {
  return error instanceof ApiError && error.code === "TOOL_REVIEW_STALE";
}
