import { ApprovalLinkView } from "@/components/g31/approval-link-view";

/**
 * Approval link — designed at mobile 390 because
 * that is where a one-shot link is opened.
 */
export default async function ApprovalLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ApprovalLinkView approvalId={id} />;
}
