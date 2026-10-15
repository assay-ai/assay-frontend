import type { ApprovalQueued, OperatorRole } from "@/interfaces/operator";
import type { StatusAnswer } from "@/libs/ApiClient";

import { approvalNeeds } from "./approvals";

/**
 * A two-person route's answer.
 *
 * Called by one operator, a two-person route (suspend from `UPHELD` or
 * `AWAITING_SECOND`, sweep, compensated, unblock, add operator, raise an
 * operator's roles or limit) runs nothing: it answers `202 { approvalId }` and
 * the action waits in the approvals inbox for a different operator. Only a
 * `200` carries the action's result. A screen that read a 202 body as the
 * result would report a suspension, a sweep or a lifted block that has not
 * happened.
 */
export type TwoPersonAnswer<T> =
  | { readonly kind: "done"; readonly result: T }
  | { readonly kind: "queued"; readonly approval: ApprovalQueued };

/**
 * A body that IS a queued request, whatever status line came with it. A
 * result row never carries `approvalId` with `status: "PENDING"`; the demo
 * layer answers every stand-in with 200, and a queued body read as a result is
 * exactly the "block lifted" lie this type exists to prevent.
 */
function isQueuedBody(data: unknown): data is ApprovalQueued {
  if (!data || typeof data !== "object") return false;
  const body = data as Record<string, unknown>;
  return typeof body.approvalId === "string" && body.status === "PENDING";
}

export function toTwoPersonAnswer<T>(answer: StatusAnswer<T | ApprovalQueued>): TwoPersonAnswer<T> {
  if (answer.status === 202 || isQueuedBody(answer.data)) {
    return { kind: "queued", approval: answer.data as ApprovalQueued };
  }
  return { kind: "done", result: answer.data as T };
}

export const APPROVALS_HREF = "/operator/approvals";

/** The inbox, opened on one approval. */
export function approvalHref(approvalId: string): string {
  return `${APPROVALS_HREF}?id=${encodeURIComponent(approvalId)}`;
}


/**
 * Who must approve a request with this register code, said from the
 * requester's side: "a second Lead adjudicator" only when the requester holds
 * that role too, otherwise "a Lead adjudicator" (or "an Admin"). Support
 * asking to lift a block needs a Lead adjudicator, not a second one. Pure.
 *
 *   approverPhrase("A-10", ["SRE", "SUP"]) → "a Lead adjudicator"
 *   approverPhrase("A-10", ["ADJL"])       → "a second Lead adjudicator"
 */
export function approverPhrase(code: string, requesterRoles: readonly OperatorRole[]): string {
  return approvalNeeds(code, requesterRoles);
}

/** "Riley Brooks", "Riley Brooks or Iris Park", "a second Lead adjudicator" when nobody is named. */
function toWhom(approvers: readonly string[] | undefined, needs: string): string {
  if (!approvers || approvers.length === 0) return needs;
  if (approvers.length === 1) return approvers[0]!;
  if (approvers.length <= 3) return `${approvers.slice(0, -1).join(", ")} or ${approvers[approvers.length - 1]}`;
  return `${approvers.slice(0, 2).join(", ")} or ${approvers.length - 2} others`;
}

/** Whole hours until `expiresAt`, as "24 h"; "24 h" when it cannot be read. */
function hoursLeft(expiresAt: string | null | undefined, now: number): string {
  const end = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(end)) return "24 h";
  const hours = Math.max(1, Math.round((end - now) / 3_600_000));
  return `${hours} h`;
}

/**
 * The result card of a request that went to the inbox — the truth about a
 * two-person action: who it went to and when it lapses, never "done".
 *
 *   sentForApproval("Lifting the block on Wallet 0x9F3c…F36c", ["Riley Brooks"], "a second Lead adjudicator", expiresAt)
 *   → { title: "Sent for approval to Riley Brooks · expires in 24 h",
 *       next: "Lifting the block on Wallet 0x9F3c…F36c has not happened yet. It runs when Riley Brooks approves it; send them the link." }
 */
export function sentForApproval(
  what: string,
  approvers: readonly string[] | undefined,
  needs: string,
  expiresAt?: string | null,
  now: number = Date.now(),
): { title: string; next: string } {
  const whom = toWhom(approvers, needs);
  return {
    title: `Sent for approval to ${whom} · expires in ${hoursLeft(expiresAt, now)}`,
    next: `${what} has not happened yet. It runs when ${whom} approves it; send them the link.`,
  };
}

/** The one sentence every two-person form shows on a 202. */
export function queuedMessage(approval: Pick<ApprovalQueued, "approvalId">): string {
  return `Sent for approval (id ${approval.approvalId}). Nothing has happened yet: a second operator approves it in the approvals inbox.`;
}
