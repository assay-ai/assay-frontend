import { debtCauseText } from "@/features/call-classes/labels";
import { formatMoney } from "@/utils/money";

import type { ReceiptState } from "./receipt-state";
import type { Receipt } from "./wire";

/**
 * The receipt's words for the four "collection" outcomes — a payment that is
 * not the usual charge or refund: an open or written-off debt, a voided debt,
 * a forfeited payment. A short headline and one line that says what it means
 * for the buyer; the timeline row in the same plain terms. The full sentences
 * stay in `STATE_CARDS` (`receipt-state.ts`).
 */
export type CollectionState = "DEBT_OUTSTANDING" | "DEBT_WRITTEN_OFF" | "DEBT_VOIDED" | "FORFEITED";

export function isCollectionState(state: ReceiptState): state is CollectionState {
  return state === "DEBT_OUTSTANDING" || state === "DEBT_WRITTEN_OFF" || state === "DEBT_VOIDED" || state === "FORFEITED";
}

export interface CollectionView {
  /** True when the buyer still owes the listed price (open or written-off debt). */
  owed: boolean;
  headline: string;
  /** One line: what happened and what it means now. */
  explain: string;
  /** Why the payment could not be taken, when recorded (debts only). */
  cause: string | null;
  /** The timeline row for the moment it closed. */
  timeline: { label: string; meta: string };
}

export function collectionView(state: CollectionState, receipt: Pick<Receipt, "listedPrice" | "chargeNote">): CollectionView {
  const listed = formatMoney(receipt.listedPrice, { decimals: 4 });
  const cause = receipt.chargeNote ? debtCauseText(receipt.chargeNote) : null;
  switch (state) {
    case "DEBT_OUTSTANDING":
      return {
        owed: true,
        headline: `You owe ${listed} for this call`,
        explain:
          "It was served and passed, but the payment could not be taken from your escrow. Paid calls are paused until you settle; free calls still work.",
        cause,
        timeline: { label: "Payment not taken yet: you owe it", meta: `${listed} still held in your escrow` },
      };
    case "DEBT_WRITTEN_OFF":
      return {
        owed: true,
        headline: `You still owe ${listed} for this call`,
        explain:
          "It was never settled, so the hold went back to your escrow and the provider was not paid. Paid calls stay paused until you settle; settling pays the provider.",
        cause,
        timeline: { label: "Hold released, provider not paid", meta: `${listed} still owed by you` },
      };
    case "DEBT_VOIDED":
      return {
        owed: false,
        headline: "Not charged: nothing is owed",
        explain:
          "The payment had lapsed, and the call then failed its checks, so the debt was cancelled. The hold went back to you and the provider was not paid.",
        cause: null,
        timeline: { label: "Debt cancelled: failed its checks", meta: "not charged" },
      };
    case "FORFEITED":
      return {
        owed: false,
        headline: "Not charged: the provider gave up this payment",
        explain:
          "The call passed, but the provider's account could not be paid (its stake was below the minimum, or it was blocked), so the hold went back to you.",
        cause: null,
        timeline: { label: "Not charged: provider forfeited", meta: "not charged" },
      };
  }
}
