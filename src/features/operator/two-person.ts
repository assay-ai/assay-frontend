import type { ApprovalQueued } from "@/interfaces/operator";
import type { StatusAnswer } from "@/libs/ApiClient";

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

export function toTwoPersonAnswer<T>(answer: StatusAnswer<T | ApprovalQueued>): TwoPersonAnswer<T> {
  if (answer.status === 202) {
    return { kind: "queued", approval: answer.data as ApprovalQueued };
  }
  return { kind: "done", result: answer.data as T };
}

export const APPROVALS_HREF = "/operator/approvals";

/** The inbox, opened on one approval. */
export function approvalHref(approvalId: string): string {
  return `${APPROVALS_HREF}?id=${encodeURIComponent(approvalId)}`;
}

/** The one sentence every two-person form shows on a 202. */
export function queuedMessage(approval: Pick<ApprovalQueued, "approvalId">): string {
  return `Sent for approval (id ${approval.approvalId}). Nothing has happened yet: a second operator approves it in the approvals inbox.`;
}
