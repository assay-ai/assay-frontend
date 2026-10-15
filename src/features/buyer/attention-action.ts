import { routes } from "@/libs/routes";

/**
 * The one verb a "Needs attention" row offers, by notification event: every
 * item ends in a button that goes to the place to act. Events with nothing
 * to do (a deposit landed, a payout went out) get a "View" link or none.
 */
export interface AttentionAction {
  label: string;
  href: string;
}

export function attentionAction(note: {
  event: string;
  subjectType?: string | null;
  subjectId?: string | null;
}): AttentionAction | null {
  switch (note.event) {
    case "balance.low":
    case "balance.zero":
    case "deposit.failed":
      return { label: "Top up", href: "/funding/deposit" };
    case "spend.threshold_crossed":
      return { label: "Raise limit", href: "/limits" };
    case "velocity.anomaly":
    case "agent.paused":
      return { label: "Review agent", href: "/agents" };
    case "session.expiring":
    case "session.expired":
      return { label: "Renew key", href: "/agents" };
    case "free_quota.exhausted":
      return { label: "Add funds", href: "/funding/deposit" };
    case "payment_intent.refunded":
      return note.subjectId ? { label: "View receipt", href: routes.receipt(note.subjectId) } : { label: "View calls", href: routes.calls({ status: "not-charged" }) };
    case "withdrawal.initiated":
    case "withdrawal.completed":
    case "withdrawal_destination.added":
      return { label: "View funding", href: "/funding" };
    default:
      return null;
  }
}
