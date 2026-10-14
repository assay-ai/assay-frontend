"use client";

import { useSearchParam } from "@/hooks/useSearchParam";
import { ApprovalLinkView } from "@/components/g31/approval-link-view";

/**
 * Approval link — designed at mobile 390 because
 * that is where a one-shot link is opened.
 */
export default function ApprovalLinkPage() {
  return <ApprovalLinkView approvalId={useSearchParam("id")} />;
}
