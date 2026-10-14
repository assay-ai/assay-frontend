import type { OperatorApproval, OperatorIdentity, OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

/**
 * The approvals inbox's rules, kept out of the page so they can be tested.
 *
 * Mirrors `docs/runbooks/operator-access.md` §4 in assay-backend: which roles
 * may approve each register row, who may reject, and what each refusal means.
 */

/** What each queued action does, in plain words. */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  "slash.suspend": "Suspend a slash proposal (cancels the penalty)",
  "slash.sweep": "Open a fleet sweep across every case with the same defect",
  "slash.compensated": "Record a treasury compensation and close the case as compensated",
  "account.unblock": "Lift an account block",
  "operator.add": "Add an operator",
  "operator.change": "Raise an operator's roles or authority limit",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** The roles a second person must hold, per register code. At least one. */
export const APPROVER_ROLES: Readonly<Record<string, readonly OperatorRole[]>> = {
  "S-1": ["ADJ", "ADJL"],
  "S-11": ["ADJ", "ADJL"],
  "S-5": ["ADJL", "TRE"],
  "A-10": ["ADJL"],
  "A-12": ["OPS_ADMIN"],
  "A-13": ["OPS_ADMIN"],
};

export function approverRolesFor(code: string): readonly OperatorRole[] | null {
  return APPROVER_ROLES[code] ?? null;
}

function holdsApproverRole(code: string, roles: readonly OperatorRole[]): boolean {
  const required = approverRolesFor(code);
  // A code this build does not know: the backend decides.
  if (!required) return true;
  return roles.some((role) => required.includes(role));
}

export function isOwnRequest(approval: OperatorApproval, me: Pick<OperatorIdentity, "id">): boolean {
  return approval.requestedById === me.id;
}

/**
 * Approve is never shown on your own request: the backend refuses it with
 * `OPERATOR_SELF_APPROVAL_REFUSED`, and the inbox should not offer it.
 */
export function showApprove(approval: OperatorApproval, me: Pick<OperatorIdentity, "id">): boolean {
  return approval.status === "PENDING" && !isOwnRequest(approval, me);
}

/** Shown but held back, with this reason, when the roles do not cover the code. */
export function approveBlockedBecause(
  approval: OperatorApproval,
  me: Pick<OperatorIdentity, "roles">,
): string | null {
  if (holdsApproverRole(approval.code, me.roles)) return null;
  const required = approverRolesFor(approval.code) ?? [];
  return `Approving ${approval.code} needs ${required.join(" or ")}.`;
}

/**
 * Reject is the requester's way to withdraw, and otherwise needs a role that
 * could have approved it.
 */
export type RejectMode = "withdraw" | "reject" | null;

export function rejectMode(
  approval: OperatorApproval,
  me: Pick<OperatorIdentity, "id" | "roles">,
): RejectMode {
  if (approval.status !== "PENDING") return null;
  if (isOwnRequest(approval, me)) return "withdraw";
  return holdsApproverRole(approval.code, me.roles) ? "reject" : null;
}

/** `slash_proposal:<id>` → a link and a label. */
export function targetOf(target: string): { label: string; href: string | null } {
  const index = target.indexOf(":");
  const type = index === -1 ? target : target.slice(0, index);
  const id = index === -1 ? "" : target.slice(index + 1);
  switch (type) {
    case "slash_proposal":
      return { label: `Case ${id}`, href: `/operator/cases/${encodeURIComponent(id)}` };
    case "account_block":
      return {
        label: `Block ${id}`,
        href: `/operator/override-log?targetType=account_block&targetId=${encodeURIComponent(id)}`,
      };
    case "operator":
      return { label: `Operator ${id}`, href: "/operator/operators" };
    case "operator_wallet":
      return { label: `Wallet ${id}`, href: "/operator/operators" };
    default:
      return { label: target, href: null };
  }
}

const SUMMARY_SKIP = new Set(["proposalId", "blockId", "operatorId"]);

function show(value: unknown): string | null {
  if (value === null) return "none (unbounded)";
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** The queued request as `label: value` lines: the body's fields, the ids left to the target. */
export function payloadSummary(payload: Record<string, unknown>): { key: string; value: string }[] {
  const body =
    payload.body && typeof payload.body === "object" && !Array.isArray(payload.body)
      ? (payload.body as Record<string, unknown>)
      : payload;
  const lines: { key: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(body)) {
    if (SUMMARY_SKIP.has(key)) continue;
    const value = show(raw);
    if (value !== null && value !== "") lines.push({ key, value });
  }
  return lines;
}

/** One sentence for what an approval did, from the action's own result. */
export function approvedResultSentence(action: string, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  switch (action) {
    case "slash.sweep":
      return `Fleet sweep opened: ${String(r.matchedCount ?? "?")} matched, ${String(r.appliedCount ?? "?")} applied.`;
    case "slash.suspend":
      return "Proposal suspended. If a record stands on chain, its cancel is requested and still needs its signer.";
    case "slash.compensated":
      return "Deposit verified on chain. The case is recorded as compensated.";
    case "account.unblock":
      return `Block lifted${typeof r.subject === "string" ? ` on ${r.subject}` : ""}.`;
    case "operator.add":
      return `Operator added${typeof r.subject === "string" ? `: ${r.subject}` : ""}. They can sign in with their wallet now.`;
    case "operator.change":
      return `Operator changed${typeof r.subject === "string" ? `: ${r.subject}` : ""}.`;
    default:
      return "Approved. The action ran.";
  }
}

/**
 * An approve or reject refusal in words. The approval stays `PENDING` after
 * any failed approve, so the sentence says what can be done next.
 */
export function approvalErrorMessage(error: unknown, kind: "approve" | "reject" | "list"): string {
  if (!(error instanceof ApiError)) {
    return kind === "list" ? "The approvals could not be loaded." : "The request could not be completed.";
  }
  const tail = ` (${error.code})`;
  switch (error.code) {
    case "OPERATOR_SELF_APPROVAL_REFUSED":
      return `You asked for this action, so you cannot approve it. A different operator must.${tail}`;
    case "OPERATOR_APPROVER_ROLE_REQUIRED":
      return `Your roles do not cover this action, so you cannot ${kind === "reject" ? "reject" : "approve"} it.${tail}`;
    case "OPERATOR_APPROVER_AUTHORITY_EXCEEDED":
      return `The amount is above your authority limit. An operator with a higher limit must approve it.${tail}`;
    case "OPERATOR_APPROVAL_NOT_PENDING":
      return `This request was already approved, rejected or has expired. The list has been refreshed.${tail}`;
    case "OPERATOR_APPROVAL_NOT_FOUND":
      return `There is no such approval.${tail}`;
    case "OPERATOR_NOT_AUTHORIZED":
      return `The operator who asked is no longer active, so the action cannot run. Reject it.${tail}`;
    case "OPERATOR_SELF_CHANGE_REFUSED":
      return `This change is about your own access, and nobody may approve a change to their own row.${tail}`;
    case "NETWORK_ERROR":
      return `The API could not be reached. Check the list before you try again.${tail}`;
    default:
      if (kind === "approve") {
        return `The action was re-checked against the current state and refused: ${error.message}.${tail} It is still pending: retry once the cause is fixed, reject it, or let it expire.`;
      }
      return `${error.message}${tail}`;
  }
}

/** The pending badge: a count, `100+` past one page. */
export function pendingBadge(count: number, hasMore: boolean): string | null {
  if (count <= 0) return null;
  return hasMore ? `${count}+` : String(count);
}
