"use client";

import { useSearchParam } from "@/hooks/useSearchParam";
import { PaymentLinkView } from "@/components/g31/payment-link-view";

/**
 * A payment link (`routes.payment`) — designed at mobile 390 because that is
 * where a link from a notification is opened.
 */
export default function PaymentLinkPage() {
  return <PaymentLinkView callId={useSearchParam("id")} />;
}
