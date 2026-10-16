import { debtCauseText } from "@/features/call-classes/labels";
import { formatLocalDateTime, utcTitle, type LocalTimeOptions } from "@/libs/local-time";
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

/** The late verdict that voided a debt, from its `voided:<OUTCOME>` note; `null` when not recorded. */
export function voidedOutcome(chargeNote: string | null | undefined): "REFUND" | "VOID" | null {
  if (!chargeNote?.startsWith("voided:")) return null;
  const outcome = chargeNote.slice("voided:".length).trim().toUpperCase();
  return outcome === "VOID" ? "VOID" : outcome === "REFUND" ? "REFUND" : null;
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
          `It was served and passed, but its payment has not been collected yet: the ${listed} stays held in your escrow until you settle. ` +
          "Paid calls are paused until you settle; free calls still work.",
        cause,
        timeline: { label: "Payment not collected yet: you owe it", meta: `${listed} held in your escrow until you settle` },
      };
    case "DEBT_WRITTEN_OFF":
      return {
        owed: true,
        headline: `Written off, but you still owe ${listed} for this call`,
        explain:
          "It was not settled within 30 days, so it was written off: the hold went back to your escrow and the provider was not paid. " +
          "You still owe it: paid calls stay paused until you settle, and settling still pays the provider. Free calls still work.",
        cause,
        timeline: { label: "Written off: hold released, provider not paid", meta: `${listed} still owed by you` },
      };
    case "DEBT_VOIDED": {
      // `voided:REFUND` is a failed check; `voided:VOID` is no usable result
      // (assay-backend `voidLateRejectedDebt`, `not-charged-reason.ts`).
      const noResult = voidedOutcome(receipt.chargeNote) === "VOID";
      const why = noResult ? "had no usable result" : "failed its checks";
      return {
        owed: false,
        headline: "Not charged: nothing is owed",
        explain:
          `The payment had lapsed, and the call then ${why}, so the debt was cancelled. The hold went back to you and the provider was not paid.`,
        cause: null,
        timeline: { label: `Debt cancelled: ${noResult ? "no usable result" : "failed its checks"}`, meta: "not charged" },
      };
    }
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

/**
 * A receipt timeline stamp: the reader's local day and clock with seconds
 * ("Today 00:40:07", "Sep 15, 02:10:05"), the exact UTC instant on hover.
 * Every row carries its day, so a write-off a month after the call reads as
 * such instead of a bare "02:11" (verify-r12 P3).
 */
export function timelineStamp(
  iso: string,
  options: Pick<LocalTimeOptions, "timeZone" | "now"> = {},
): { time: string; timeTitle: string | undefined } {
  return {
    time: formatLocalDateTime(iso, { ...options, seconds: true, alwaysDay: true }),
    timeTitle: utcTitle(iso, { seconds: true }),
  };
}

/**
 * When the collection row happened: for a written-off debt, the write-off
 * itself from the debts list (the time the banner and the settle sheet show),
 * else the receipt's own settlement time.
 */
export function collectionAt(
  state: CollectionState,
  settledAt: string,
  debt: { state: string; writeOffAt: string } | null | undefined,
): string {
  return state === "DEBT_WRITTEN_OFF" && debt?.state === "WRITTEN_OFF" && debt.writeOffAt ? debt.writeOffAt : settledAt;
}
