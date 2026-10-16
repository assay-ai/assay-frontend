import { shortToolId } from "@/components/g31/use-tool-names";
import { debtCauseText } from "@/features/call-classes/labels";
import type { BuyerDebt, BuyerDebtState, CallDebt } from "@/interfaces/buyer-debt";
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

/** A debt's state; an older backend sends none, and every debt it lists is open. */
export function debtStateOf(debt: Pick<BuyerDebt, "state">): BuyerDebtState {
  return debt.state ?? "OPEN";
}

/**
 * The debts that still need a signature: `OPEN` and `WRITTEN_OFF`. A
 * `REPLACING` one is signed already and only waits for its collection.
 */
export function debtsToSign<T extends Pick<BuyerDebt, "state">>(debts: readonly T[]): T[] {
  return debts.filter((debt) => debtStateOf(debt) !== "REPLACING");
}

/**
 * Whether a debt can be settled at `nowMs`: its original voucher is past its
 * on-chain deadline (`replaceableAt`). One without the field (an older
 * backend) or with an unreadable one can be settled at once.
 */
export function isReplaceable(debt: Pick<BuyerDebt, "replaceableAt">, nowMs: number): boolean {
  const at = debt.replaceableAt ? Date.parse(debt.replaceableAt) : Number.NaN;
  return Number.isNaN(at) || at <= nowMs;
}

/** The earliest `replaceableAt` still ahead of `nowMs`, in ms, or `null`. */
export function nextReplaceableAt(debts: readonly Pick<BuyerDebt, "replaceableAt">[], nowMs: number): number | null {
  let next: number | null = null;
  for (const debt of debts) {
    if (isReplaceable(debt, nowMs)) continue;
    const at = Date.parse(debt.replaceableAt!);
    if (next === null || at < next) next = at;
  }
  return next;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function debtBannerTitle(debts: readonly Pick<BuyerDebt, "amount" | "state">[]): string {
  const toSign = debtsToSign(debts);
  if (toSign.length === 0) {
    return debts.length === 1
      ? "Collecting the payment you signed"
      : `Collecting ${debts.length} payments you signed`;
  }
  if (toSign.length === 1) {
    return `Settle ${formatMoney(toSign[0].amount, { decimals: 4 })} your agent owes for a call`;
  }
  return `Settle ${toSign.length} payments your agents owe`;
}

/** The sentence for one debt, in plain words, by its state. */
export function debtSentence(debt: Pick<BuyerDebt, "cause" | "writeOffAt" | "state">): string {
  const state = debtStateOf(debt);
  if (state === "REPLACING") {
    return (
      "You signed the payment for a call your agent made, and it is being collected from your escrow " +
      "(about a minute). Paid calls resume once it is collected. Free calls still work."
    );
  }
  const why = `A call your agent made could not be collected from your escrow (${debtCauseText(debt.cause)})`;
  if (state === "WRITTEN_OFF") {
    return (
      `${why}, and it was written off on ${debtDate(debt.writeOffAt)}: the funds held for it were released ` +
      "and the provider was not paid. Paid calls stay paused until you settle it, and settling it pays " +
      "the provider. Free calls still work."
    );
  }
  return (
    `${why}. Paid calls are paused until you settle it. Free calls still work. ` +
    `If not settled by ${debtDate(debt.writeOffAt)}, it is written off and the provider goes unpaid, ` +
    "but paid calls stay paused until you settle it."
  );
}

/** The banner's description for the debts, oldest first. */
export function debtBannerDescription(debts: readonly BuyerDebt[]): string {
  if (debts.length === 0) return "";
  if (debts.length === 1) return debtSentence(debts[0]);
  const open = debts.filter((debt) => debtStateOf(debt) === "OPEN");
  const writtenOff = debts.filter((debt) => debtStateOf(debt) === "WRITTEN_OFF");
  const replacing = debts.length - open.length - writtenOff.length;
  if (open.length + writtenOff.length === 0) {
    return (
      `You signed the payments for ${debts.length} calls your agents made, and they are being collected ` +
      "from your escrow. Paid calls resume once they are collected. Free calls still work."
    );
  }
  const parts = [
    `${debts.length} calls your agents made could not be collected from your escrow. ` +
      "Paid calls are paused until every one is settled. Free calls still work.",
  ];
  if (writtenOff.length > 0) {
    const n = writtenOff.length;
    parts.push(
      `${n} ${plural(n, "was", "were")} written off: ${plural(n, "its provider was", "their providers were")} ` +
        `not paid, and settling ${plural(n, "it", "them")} pays ${plural(n, "the provider", "them")}.`,
    );
  }
  if (replacing > 0) {
    parts.push(`${replacing} ${plural(replacing, "is", "are")} signed and being collected.`);
  }
  if (open.length > 0) {
    const earliest = open.reduce((first, debt) => (debt.writeOffAt < first.writeOffAt ? debt : first));
    parts.push(
      open.length === 1
        ? `If the open one is not settled by ${debtDate(earliest.writeOffAt)}, it is written off and its provider goes unpaid.`
        : `If not settled by ${debtDate(earliest.writeOffAt)} (the earliest), the open ones are written off and those providers go unpaid.`,
    );
  }
  return parts.join(" ");
}

const ROW_STATE: Record<BuyerDebtState, string | null> = {
  OPEN: null,
  REPLACING: "signed, being collected",
  WRITTEN_OFF: "written off",
};

/**
 * One debt row: `$2.5000 · price_quote · the agent key that signed it was revoked · written off`.
 * `toolName` resolves the tool id (the catalogue's `nameOf`); without it, or
 * for a tool the catalogue does not know, the row shows a short id.
 */
export function debtRowText(debt: BuyerDebt, toolName?: (toolId: string) => string): string {
  const state = ROW_STATE[debtStateOf(debt)];
  const named = toolName?.(debt.toolId);
  const tool = named && named !== debt.toolId ? named : shortToolId(debt.toolId);
  return (
    `${formatMoney(debt.amount, { decimals: 4 })} · ${tool} · ${debtCauseText(debt.cause)}` +
    (state ? ` · ${state}` : "")
  );
}

/**
 * Signing settles the call; the money is collected by the next redemption
 * pass, and paid calls resume only once it is.
 */
export function settledToast(remaining: number): string {
  return remaining === 0
    ? "Signed. The payment is collected from your escrow within about a minute; paid calls resume once it is."
    : `Signed. ${remaining} more call${remaining === 1 ? " is" : "s are"} still to settle before paid calls resume.`;
}

export {
  debtLocalTime,
  debtOutstandingContext,
  debtRefusalSentence,
  notYetReplaceableSentence,
  settleDebtErrorSentence,
} from "@/libs/buyer-debt";

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
  debt?: CallDebt | null;
}): string | null {
  if (call.debt === "OUTSTANDING") return "payment not collected yet · settle it to resume paid calls";
  if (call.debt === "WRITTEN_OFF") return "written off for the provider · you still owe it to resume paid calls";
  if (call.debt === "VOIDED") return "voided · failed its checks later: not charged, provider not paid";
  if (call.forfeited) return "not charged: the provider forfeited";
  return null;
}

/**
 * Whether a call's uncharged amount is NOT the guarantee's withholding: a
 * forfeited, written-off or voided call was not charged, but it stays SETTLED
 * and nothing was withheld for it, so `listed − charged` must not be counted
 * as withheld.
 */
export function uncollectedNotWithheld(call: {
  forfeited?: boolean;
  debt?: CallDebt | null;
}): boolean {
  return call.forfeited === true || call.debt === "WRITTEN_OFF" || call.debt === "VOIDED";
}

/**
 * The "Held" subtitle. A debt's price stays held in the escrow until the
 * buyer settles it, so those holds are not calls in flight and do not return
 * on their own within 24h; they are counted apart.
 */
export function heldCallsText(
  openHoldIntentIds: readonly string[],
  owedIntentIds: ReadonlySet<string>,
  { short = false }: { short?: boolean } = {},
): string {
  const owed = openHoldIntentIds.filter((id) => owedIntentIds.has(id)).length;
  const inFlight = openHoldIntentIds.length - owed;
  const calls = (n: number) => `${n} ${n === 1 ? "call" : "calls"}`;
  const parts: string[] = [];
  if (inFlight > 0 || owed === 0) {
    parts.push(short ? `${calls(inFlight)} in flight` : `${calls(inFlight)} in flight — returns within 24h`);
  }
  if (owed > 0) {
    parts.push(short ? `${owed} unpaid` : `${owed} unpaid ${owed === 1 ? "call" : "calls"} — held until it is collected`);
  }
  return parts.join(" · ");
}
