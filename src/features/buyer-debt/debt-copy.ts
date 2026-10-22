import { shortToolId } from "@/components/g31/use-tool-names";
import { debtCauseText } from "@/features/call-classes/labels";
import { formatRemaining } from "@/hooks/useCountdown";
import { PAYMENT_DEBT_NOT_YET_REPLACEABLE, type BuyerDebt, type BuyerDebtState, type CallDebt } from "@/interfaces/buyer-debt";
import { settleDebtErrorSentence as settleDebtErrorSentenceInZone } from "@/libs/buyer-debt";
import { formatDateTime } from "@/libs/utc-time";
import { formatMoney } from "@/utils/money";

/**
 * The buyer's words for buyer debt. One place, so the banner, the receipt and
 * a refused call say the same thing.
 */

export interface DeadlineOptions {
  /** "Now"; defaults to `Date.now()`. */
  now?: number;
}

/**
 * "in 12 days", "in 5h 20m", or `null` once it has passed. Days are whole
 * days from two on, so a far deadline does not read as a timer.
 */
export function deadlineCountdown(iso: string, options: DeadlineOptions = {}): string | null {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  const msLeft = at - (options.now ?? Date.now());
  if (msLeft <= 0) return null;
  const days = Math.floor(msLeft / 86_400_000);
  return days >= 2 ? `in ${days} days` : `in ${formatRemaining(msLeft)}`;
}

/**
 * The write-off moment in UTC, labelled, and while it is ahead a countdown:
 * "Nov 15, 18:00 UTC (in 12 days)". Day and time, never a bare date, which
 * read a day late west of UTC (review 2026-10-17 P2-1).
 */
export function debtDeadline(iso: string, options: DeadlineOptions = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // Always UTC, labelled, like every time on screen (`utc-time.ts`).
  const when = formatDateTime(date, { ...options, alwaysDay: true, midSentence: true });
  const countdown = deadlineCountdown(iso, options);
  return countdown ? `${when} (${countdown})` : when;
}

/** A debt's state. */
export function debtStateOf(debt: Pick<BuyerDebt, "state">): BuyerDebtState {
  return debt.state;
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
 * on-chain deadline (`replaceableAt`). One with an unreadable deadline can be
 * settled at once.
 */
export function isReplaceable(debt: Pick<BuyerDebt, "replaceableAt">, nowMs: number): boolean {
  const at = Date.parse(debt.replaceableAt);
  return Number.isNaN(at) || at <= nowMs;
}

/** The earliest `replaceableAt` still ahead of `nowMs`, in ms, or `null`. */
export function nextReplaceableAt(debts: readonly Pick<BuyerDebt, "replaceableAt">[], nowMs: number): number | null {
  let next: number | null = null;
  for (const debt of debts) {
    if (isReplaceable(debt, nowMs)) continue;
    const at = Date.parse(debt.replaceableAt);
    if (next === null || at < next) next = at;
  }
  return next;
}

/**
 * Why a debt cannot be settled yet, with the moment in UTC and a countdown:
 * "You can settle this from today 07:05 UTC (in 12m):
 * the original payment must expire on chain first, so you never pay twice."
 * `subject: "the first"` is for several waiting debts (the time is the
 * earliest); `midSentence` starts it in lowercase, after a colon.
 */
export function notYetSettleSentence(
  replaceableAt: string | null | undefined,
  {
    subject = "this",
    midSentence = false,
    ...options
  }: DeadlineOptions & { subject?: "this" | "it" | "the first"; midSentence?: boolean } = {},
): string {
  const valid = replaceableAt && !Number.isNaN(Date.parse(replaceableAt));
  const from = valid ? `from ${debtDeadline(replaceableAt, options)}` : "in a few minutes";
  return (
    `${midSentence ? "you" : "You"} can settle ${subject} ${from}: the original payment must expire on chain first, ` +
    "so you never pay twice."
  );
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
      `${why}, and it was written off on ${debtDeadline(debt.writeOffAt)}: the funds held for it were released ` +
      "and the provider was not paid. Paid calls stay paused until you settle it, and settling it pays " +
      "the provider. Free calls still work."
    );
  }
  return (
    `${why}. Paid calls are paused until you settle it. Free calls still work. ` +
    `If not settled by ${debtDeadline(debt.writeOffAt)}, it is written off: you still owe it, and the provider is paid only once you settle. ` +
    "Paid calls stay paused until you do."
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
        ? `If the open one is not settled by ${debtDeadline(earliest.writeOffAt)}, it is written off: still owed, and its provider is paid only once you settle.`
        : `If the earliest is not settled by ${debtDeadline(earliest.writeOffAt)}, the open ones are written off from then on: still owed, and those providers are paid only once you settle.`,
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

export { debtOutstandingContext, debtRefusalSentence } from "@/libs/buyer-debt";

/** "Oct 17, 14:05 UTC" (day-relative near now); the text unchanged when it is not a time. */
export function debtTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDateTime(date, { alwaysDay: true, midSentence: true });
}

/**
 * Why a debt cannot be settled yet, with the time it can, in UTC. Replaces the
 * one in `libs/buyer-debt.ts`, which formats in the reader's zone and stays as
 * it is (a signing file, kept identical to main).
 */
export function notYetReplaceableSentence(
  replaceableAt: string | null | undefined,
  subject: "this" | "it" | "the first" = "this",
): string {
  const from = replaceableAt ? `from ${debtTime(replaceableAt)}` : "in a few minutes";
  const you = subject === "this" ? "You" : "you";
  return `${you} can settle ${subject} ${from} (the original payment must expire on chain first, so you never pay twice).`;
}

/** `libs/buyer-debt`'s `settleDebtErrorSentence`, with the not-yet-settleable time in UTC. */
export function settleDebtErrorSentence(error: unknown): string | null {
  const err = error as { code?: string; context?: Record<string, unknown> } | null | undefined;
  if (err?.code === PAYMENT_DEBT_NOT_YET_REPLACEABLE) {
    const at = err.context?.replaceableAt;
    return `${notYetReplaceableSentence(typeof at === "string" ? at : null)} Nothing was signed.`;
  }
  return settleDebtErrorSentenceInZone(error);
}

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
  /** An upheld report cancelled the charge (also `debt` VOIDED): not a late verdict (BUG-X-01). */
  refundedByReport?: boolean;
}): string | null {
  if (call.debt === "OUTSTANDING") return "Payment not collected · settle to resume paid calls";
  if (call.debt === "WRITTEN_OFF") return "Written off · still owed to resume paid calls";
  if (call.refundedByReport) return "Refunded after your report · not charged";
  if (call.debt === "VOIDED") return "Debt cancelled by a late verdict · not charged";
  if (call.forfeited) return "Not charged · provider forfeited";
  return null;
}

/**
 * Whether a call's uncharged amount is NOT the guarantee's withholding: a
 * forfeited, written-off or voided call was not charged, but it stays SETTLED
 * and nothing was withheld for it, so `listed − charged` must not be counted
 * as withheld.
 */
export function uncollectedNotWithheld(call: { forfeited: boolean; debt: CallDebt | null }): boolean {
  return call.forfeited || call.debt === "WRITTEN_OFF" || call.debt === "VOIDED";
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

/** How many open holds are buyer debt (held until collected) and how many are calls being checked. */
function heldSplit(openHoldIntentIds: readonly string[], owedIntentIds: ReadonlySet<string>) {
  const owed = openHoldIntentIds.filter((id) => owedIntentIds.has(id)).length;
  return { owed, inFlight: openHoldIntentIds.length - owed };
}

/**
 * Funding's line about the escrow's held amount. Calls being checked come back
 * or go to providers within minutes; an unpaid call's price stays held until
 * its payment is collected, signed or not, so it is never called in flight.
 */
export function escrowHeldText(
  amount: string,
  openHoldIntentIds: readonly string[],
  owedIntentIds: ReadonlySet<string>,
): string {
  const { owed, inFlight } = heldSplit(openHoldIntentIds, owedIntentIds);
  const checking = "it comes back or goes to providers within minutes";
  if (owed === 0) return `${amount} more is held by calls being checked; ${checking}`;
  const unpaid = `${owed} unpaid ${owed === 1 ? "call" : "calls"}`;
  const until = `held until ${owed === 1 ? "it is" : "they are"} collected`;
  if (inFlight === 0) return `${amount} more is held for ${unpaid}, ${until} (see the banner)`;
  return `${amount} more is held: ${inFlight} ${inFlight === 1 ? "call" : "calls"} being checked (${checking}) and ${unpaid}, ${until}`;
}

/**
 * The held segment's label in the escrow split. One name for the held figure
 * on every Funding line: "calls being checked", or the debt's own words.
 */
export function heldSegmentLabel(openHoldIntentIds: readonly string[], owedIntentIds: ReadonlySet<string>): string {
  const { owed, inFlight } = heldSplit(openHoldIntentIds, owedIntentIds);
  if (owed === 0) return "Held by calls being checked";
  return inFlight === 0 ? "Held for unpaid calls" : "Held by calls being checked and unpaid calls";
}

/**
 * The Withdraw sheet's line about the held amount, and whether any of it is
 * buyer debt (the sheet then offers to settle). A debt's price does not come
 * back in minutes: it stays held until the payment is collected, so the line
 * says so and points to settling it.
 */
export function withdrawHeldText(
  amount: string,
  openHoldIntentIds: readonly string[],
  owedIntentIds: ReadonlySet<string>,
): { text: string; owed: number } {
  const { owed, inFlight } = heldSplit(openHoldIntentIds, owedIntentIds);
  const checking = "it comes back or goes to providers within minutes";
  if (owed === 0) return { text: `${amount} is held by calls being checked; ${checking}.`, owed };
  const unpaid = `${owed} unpaid ${owed === 1 ? "call" : "calls"}`;
  const until = `held until ${owed === 1 ? "its payment is" : "their payments are"} collected`;
  const settle = `Settle ${owed === 1 ? "it" : "them"} to free that money.`;
  if (inFlight === 0) return { text: `${amount} is held for ${unpaid}, ${until}. ${settle}`, owed };
  return {
    text:
      `${amount} is held: ${inFlight} ${inFlight === 1 ? "call" : "calls"} being checked (${checking}) and ${unpaid}, ` +
      `${until}. ${settle}`,
    owed,
  };
}

/** Why nothing can be withdrawn while everything in the escrow is held. */
export function withdrawAllHeldReason(openHoldIntentIds: readonly string[], owedIntentIds: ReadonlySet<string>): string {
  const { owed, inFlight } = heldSplit(openHoldIntentIds, owedIntentIds);
  if (owed === 0) return "Everything in your escrow is held by calls being checked. Try again in a few minutes.";
  const unpaid = `${owed} unpaid ${owed === 1 ? "call" : "calls"}`;
  const until = `held until ${owed === 1 ? "its payment is" : "their payments are"} collected`;
  if (inFlight === 0) {
    return `Everything in your escrow is held for ${unpaid}, ${until}. Settle ${owed === 1 ? "it" : "them"} first, then withdraw what is left.`;
  }
  return (
    `Everything in your escrow is held: by calls being checked (back within minutes) and by ${unpaid}, ${until}. ` +
    `Settle ${owed === 1 ? "it" : "them"}, then withdraw what is left.`
  );
}

/**
 * Close account's line about open holds: calls being checked are charged or
 * come back within 24 hours; an unpaid call's price stays held until it is
 * collected, so that part says to settle it.
 */
export function closeAccountHeldText(
  openHoldIntentIds: readonly string[],
  owedIntentIds: ReadonlySet<string>,
): { checking: string | null; unpaid: string | null } {
  const { owed, inFlight } = heldSplit(openHoldIntentIds, owedIntentIds);
  return {
    checking:
      inFlight > 0
        ? `${inFlight} ${inFlight === 1 ? "call is" : "calls are"} still being checked. Their held money is charged or comes back within 24 hours; then withdraw it too.`
        : null,
    unpaid:
      owed > 0
        ? `${owed} unpaid ${owed === 1 ? "call keeps its" : "calls keep their"} price held until ${owed === 1 ? "it is" : "they are"} collected: settle ${owed === 1 ? "it" : "them"}, then withdraw what is left.`
        : null,
  };
}
