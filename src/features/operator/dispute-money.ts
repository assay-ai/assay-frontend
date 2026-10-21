/**
 * Where the money of a disputed call is, in words, for the operator dispute page.
 *
 * The API's `collectionState` never says "held" (it is NORMAL while a hold is
 * open), so the label comes from the refund plan together with the dispute's
 * own state: an upheld dispute whose hold has not moved yet reads differently
 * from one still waiting for a decision.
 */
const COLLECTION_STATE: Readonly<Record<string, string>> = {
  NORMAL: "Collected for the provider",
  DEBT_OUTSTANDING: "Buyer owes it (debt)",
  WRITTEN_OFF: "Written off (provider unpaid)",
  VOIDED: "Voided (not charged)",
  PROVIDER_FORFEITED: "Provider forfeited (buyer not charged)",
};

export function collectionLabel(intent: { collectionState: string; refundPlan?: string | null }, disputeState: string): string {
  const decidedForProvider = disputeState === "REJECTED" || disputeState === "WITHDRAWN";
  switch (intent.refundPlan) {
    case "RELEASE_HELD":
      if (disputeState === "UPHELD") return "Held: being refunded to the buyer";
      if (decidedForProvider) return "Held: goes to the provider when the hold ends";
      return "Held: not the provider's until decided";
    case "COLLECTION_IN_PROGRESS":
      return decidedForProvider ? "Held: being collected for the provider" : "Payment is moving right now";
    case "ALREADY_REFUNDED":
      return "Refunded to the buyer (or the debt cancelled)";
    default:
      return COLLECTION_STATE[intent.collectionState] ?? intent.collectionState;
  }
}
