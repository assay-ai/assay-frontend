import type { BuyerEscrow, Money, UnsettledVouchers } from "@/interfaces";
import { formatDateTime } from "@/libs/utc-time";
import { formatMoney } from "@/utils/money";

/**
 * The buyer's words for payments that passed and are not settled on chain yet
 * (round-2 SPEC-W2 §11). The figures are the backend's own: `GET /escrow`'s
 * W2 fields (API-W2 §3.3), or on an older server `GET /escrow/unsettled`;
 * never worked out from a clock here. The settle round waits at most about an
 * hour (30 minutes per call today, up to 55 minutes for a channel), so that is
 * the promise when the server names no time: a maximum, never "in a minute".
 */

type EscrowW2 = Pick<
  BuyerEscrow,
  "pendingSettlement" | "pendingSettlementCalls" | "nextSettleAt" | "signedLast24h" | "withdrawableUpTo" | "withdrawableAt"
>;

function dollars(money: Money): string {
  const atomic = BigInt(money.amount || "0");
  const sub = atomic > 0n && atomic * 100n < 10n ** BigInt(money.decimals);
  return formatMoney(money, { decimals: sub ? 4 : 2 });
}

function positive(money: Money | null | undefined): money is Money {
  return Boolean(money?.amount && BigInt(money.amount) > 0n);
}

/** Whether `GET /escrow` carries the W2 settlement fields (then `/escrow/unsettled` is not needed). */
export function escrowReportsSettlement(escrow: EscrowW2 | null | undefined): boolean {
  return escrow?.pendingSettlement !== undefined;
}

/** What is pending settlement: the escrow's own figure, else the older endpoint's; null when none or unknown. */
export function pendingSettlement(
  escrow: EscrowW2 | null | undefined,
  unsettled: UnsettledVouchers | null | undefined,
): { amount: Money; calls: number | null; nextSettleAt: string | null } | null {
  if (escrowReportsSettlement(escrow)) {
    return positive(escrow!.pendingSettlement)
      ? { amount: escrow!.pendingSettlement, calls: escrow!.pendingSettlementCalls ?? null, nextSettleAt: escrow!.nextSettleAt ?? null }
      : null;
  }
  return unsettled && unsettled.count > 0 && positive(unsettled.amount)
    ? { amount: unsettled.amount, calls: unsettled.count, nextSettleAt: null }
    : null;
}

/**
 * What already left the escrow on chain into the dispute hold (BUG-R2-BUY-01):
 * `GET /escrow`'s `onChainHeld`. Null when none, or on an older server that
 * does not send it (nothing is said, as before).
 */
export function onChainHeld(
  escrow: Pick<BuyerEscrow, "onChainHeld" | "onChainHeldCalls" | "onChainHoldEndsAt"> | null | undefined,
): { amount: Money; calls: number | null; endsAt: string | null } | null {
  if (!positive(escrow?.onChainHeld)) return null;
  return { amount: escrow!.onChainHeld!, calls: escrow!.onChainHeldCalls ?? null, endsAt: escrow!.onChainHoldEndsAt ?? null };
}

/**
 * Funding's "Pending settlement" line, or null when nothing is pending or the
 * server could not say. It says the maximum wait, never the server's
 * `nextSettleAt`: that is a moving "now + 30 minutes" while calls keep
 * coming, so a clock time would slide (review 2026-10-31). Its calls are
 * said here only: Funding's held line leaves them out (`heldBesidePending`,
 * BUG-R2-DEV-01) until the settle lands and they move to the dispute hold.
 */
export function pendingSettlementLine(pending: ReturnType<typeof pendingSettlement>): { label: string; text: string } | null {
  if (!pending) return null;
  const calls = pending.calls
    ? ` for ${pending.calls} paid ${pending.calls === 1 ? "call" : "calls"} not yet recorded on chain`
    : " for paid calls not yet recorded on chain";
  return {
    label: "Pending settlement",
    text: `${dollars(pending.amount)}${calls}, still in your escrow; taken on chain in the next settlement round (within about an hour).`,
  };
}

/**
 * The 24-hour meter's figure and label: every payment signed in the last 24
 * hours, settled or not. From the escrow's own `signedLast24h`, else (older
 * server) what the window must hold for the unsettled payments (the chain's
 * counter plus them). Unknown: the chain's counter alone, under its own words.
 */
export function signedInWindow(
  escrow: (EscrowW2 & Pick<BuyerEscrow, "spentInWindow">) | null | undefined,
  unsettled: UnsettledVouchers | null | undefined,
): { label: string; used: Money | null } {
  const label = "Signed in the last 24 h, including not yet settled, all agents";
  if (escrow?.signedLast24h) return { label, used: escrow.signedLast24h };
  if (unsettled) return { label, used: unsettled.count > 0 ? unsettled.windowNeeds : (escrow?.spentInWindow ?? unsettled.windowNeeds) };
  return { label: "Spent from your escrow in the last 24 hours, all agents", used: escrow?.spentInWindow ?? null };
}

/**
 * What a withdrawal pays while earlier calls are still settling: those are
 * paid first, so the buyer receives up to `min(requested, balance − pending)`
 * (an upper bound: a report upheld before the settle only raises it). `upTo`
 * is the server's figure when it sends one (`withdrawableUpTo`); otherwise it
 * is worked out from the same three figures. Null when nothing is settling, a
 * figure is missing, or the settling money leaves the whole request payable
 * (then "You receive up to the amount" already says it, review 2026-10-31).
 */
export function withdrawSettlingNote({
  requested,
  balance,
  pending,
  upTo = null,
  availableAt,
  availableIn = null,
  now = Date.now(),
}: {
  requested: Money | null;
  balance: Money | null | undefined;
  pending: Money | null | undefined;
  /** The server's `withdrawableUpTo`, when it sends one. */
  upTo?: Money | null;
  /** ISO-8601 or epoch ms: when the withdrawal can be claimed. */
  availableAt: string | number | null | undefined;
  /** For a request not made yet: the wait, "1 hour" (never `now + delay` as an instant). */
  availableIn?: string | null;
  now?: number;
}): string | null {
  if (!requested || !positive(pending)) return null;
  let receive = upTo;
  if (!receive) {
    if (!balance) return null;
    const left = BigInt(balance.amount || "0") - BigInt(pending.amount);
    const cap = left > 0n ? left : 0n;
    const req = BigInt(requested.amount || "0");
    receive = { ...requested, amount: (req < cap ? req : cap).toString() };
  }
  if (BigInt(receive.amount || "0") >= BigInt(requested.amount || "0")) return null;
  const when =
    availableAt != null
      ? ` (available ${formatDateTime(availableAt, { now, midSentence: true })})`
      : availableIn
        ? ` (available about ${availableIn} after you ask)`
        : "";
  return `About ${dollars(pending)} from earlier calls is still settling and is paid first; you will receive up to ${dollars(receive)}${when}.`;
}

/** The standing withdrawal's pause, and the way out (SPEC-W2 §11). */
export function withdrawalPausedText(chainName: string | null): string {
  return `Every agent's paid calls on ${chainName ?? "this chain"} are paused while a withdrawal is pending; claim it or cancel it to resume. Free calls keep working.`;
}
