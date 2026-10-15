import { debtCauseText } from "@/features/call-classes/labels";
import type { BuyerDebt } from "@/interfaces/buyer-debt";
import { formatMoney } from "@/utils/money";

/**
 * The buyer's words for buyer debt. One place, so the banner, the receipt and
 * a refused call say the same thing.
 */

/** `16 Nov 2026`, in UTC — the day the debt is written off. */
export function debtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function debtBannerTitle(debts: readonly Pick<BuyerDebt, "amount">[]): string {
  if (debts.length === 1) {
    return `Settle ${formatMoney(debts[0].amount, { decimals: 4 })} your agent owes for a call`;
  }
  return `Settle ${debts.length} calls your agents owe for`;
}

/** The sentence for one debt, in plain words. */
export function debtSentence(debt: Pick<BuyerDebt, "cause" | "writeOffAt">): string {
  return (
    `A call your agent made could not be collected from your escrow (${debtCauseText(debt.cause)}). ` +
    "Paid calls are paused until you settle it. Free calls still work. " +
    `If not settled by ${debtDate(debt.writeOffAt)}, the provider goes unpaid.`
  );
}

/** The banner's description for the open debts, oldest first. */
export function debtBannerDescription(debts: readonly BuyerDebt[]): string {
  if (debts.length === 0) return "";
  if (debts.length === 1) return debtSentence(debts[0]);
  const earliest = debts.reduce((first, debt) => (debt.writeOffAt < first.writeOffAt ? debt : first));
  return (
    `${debts.length} calls your agents made could not be collected from your escrow. ` +
    "Paid calls are paused until you settle them. Free calls still work. " +
    `If not settled by ${debtDate(earliest.writeOffAt)} (the earliest), those providers go unpaid.`
  );
}

/** One debt row: `$2.5000 · price_quote · the agent key that signed it was revoked`. */
export function debtRowText(debt: BuyerDebt): string {
  return `${formatMoney(debt.amount, { decimals: 4 })} · ${debt.toolId} · ${debtCauseText(debt.cause)}`;
}

/** Signing settles the call; the money is collected by the next redemption pass. */
export function settledToast(remaining: number): string {
  return remaining === 0
    ? "Signed. The payment is collected from your escrow within about a minute, and paid calls work again."
    : `Signed. ${remaining} more call${remaining === 1 ? " is" : "s are"} still to settle before paid calls work again.`;
}

export { debtOutstandingContext, debtRefusalSentence } from "@/libs/buyer-debt";

/**
 * The debts this session can settle: the session account's own, oldest first.
 * The list also carries the organization's other wallets' debts, which only
 * that wallet's own session can settle.
 */
export function splitDebts(data: { account: string; debts: readonly BuyerDebt[] } | null | undefined): {
  own: BuyerDebt[];
  others: BuyerDebt[];
} {
  if (!data) return { own: [], others: [] };
  const account = data.account.toLowerCase();
  const own = data.debts.filter((debt) => debt.payer.toLowerCase() === account);
  const others = data.debts.filter((debt) => debt.payer.toLowerCase() !== account);
  return { own, others };
}

/**
 * A call's payment, when it is not the usual charge or refund — for a list row
 * beside the verdict. `null` for every ordinary call.
 */
export function callPaymentNote(call: {
  forfeited?: boolean;
  debt?: "OUTSTANDING" | "WRITTEN_OFF" | null;
}): string | null {
  if (call.debt === "OUTSTANDING") return "payment not collected yet · settle it to resume paid calls";
  if (call.debt === "WRITTEN_OFF") return "written off · not charged, provider not paid";
  if (call.forfeited) return "not charged: the provider forfeited";
  return null;
}

/**
 * Whether a call's uncharged amount is NOT the guarantee's withholding: a
 * forfeited or written-off call was not charged, but nothing was withheld for
 * it, so `listed − charged` must not be counted as withheld.
 */
export function uncollectedNotWithheld(call: {
  forfeited?: boolean;
  debt?: "OUTSTANDING" | "WRITTEN_OFF" | null;
}): boolean {
  return call.forfeited === true || call.debt === "WRITTEN_OFF";
}
