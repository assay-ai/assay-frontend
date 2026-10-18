import { contractNoticeAction, readContractNotice } from "@/features/toolsets/contract-notices";
import { readUpdateNotice, updateNoticeHref } from "@/features/toolsets/sharing";
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
  payload?: unknown;
}): AttentionAction | null {
  switch (note.event) {
    case "toolset.update_available": {
      const notice = readUpdateNotice(note.payload);
      return notice ? { label: "See what changed", href: updateNoticeHref(notice) } : { label: "Review agents", href: "/agents" };
    }
    case "tool_version.deprecated":
    case "tool_version.retired": {
      const notice = readContractNotice(note.payload);
      if (notice) return contractNoticeAction(notice);
      return note.subjectId ? { label: "See the versions", href: routes.exploreTool(note.subjectId) } : null;
    }
    case "call_dispute.opened":
    case "call_dispute.responded":
    case "call_dispute.decided":
    case "call_dispute.refunded": {
      // The payload says whose side the notice is for: the provider's goes to its console.
      const provider = (note.payload as { role?: unknown } | null | undefined)?.role === "provider";
      if (provider) return note.subjectId ? { label: note.event === "call_dispute.opened" ? "Reply" : "Open the report", href: routes.providerCallDispute(note.subjectId) } : { label: "Open reports", href: "/provider/call-disputes" };
      return note.subjectId ? { label: "See the report", href: routes.callDispute(note.subjectId) } : { label: "See your reports", href: "/spend/disputes" };
    }
    case "provider_tool.approved":
    case "provider_tool.rejected":
    case "provider_tool.taken_down":
    case "provider_tool.takedown_lifted":
      return note.subjectId ? { label: "Open your API", href: routes.providerApi(note.subjectId) } : { label: "Your APIs", href: "/provider/apis" };
    case "provider_tool.promotion_invited":
      return { label: "See the invitation", href: "/provider/apis" };
    case "balance.low":
    case "balance.zero":
    case "deposit.failed":
      return { label: "Top up", href: "/funding?action=deposit" };
    case "spend.threshold_crossed":
      return { label: "Raise limit", href: "/limits" };
    case "velocity.anomaly":
    case "agent.paused":
      return { label: "Review agent", href: "/agents" };
    case "session.expiring":
    case "session.expired":
      return { label: "Renew key", href: "/agents" };
    case "free_quota.exhausted":
      return { label: "Add funds", href: "/funding?action=deposit" };
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
