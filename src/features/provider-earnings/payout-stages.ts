import type { Money, PayoutCadence, ProviderPayout, ProviderPayoutState } from "@/interfaces";
import { formatDateTime } from "@/libs/utc-time";

/**
 * The four stages a passed call's money goes through on its way to the
 * provider (round-2 SPEC-W2 §11), in order:
 *
 *  1. "Passed, being recorded on chain" — `awaitingSettlement`: served and
 *     passed, the payment not settled on chain yet;
 *  2. "In the dispute hold until HH:MM UTC" — `inDisputeHold`: recorded,
 *     held while a buyer can still report it (at least 1 hour; a channel
 *     bucket rounds up to the next full hour);
 *  3. "Ready, paid in the next payout (about HH:MM UTC)" — `readyForPayout`:
 *     the hold ended, waiting for the payout run (`nextPayoutAt`);
 *  4. "In your wallet" — paid out.
 *
 * Apart from the four, only when there is some: "Not paid yet" — `unpaid`,
 * a payout the token issuer blocked from reaching the payout address (a
 * freeze). The escrow keeps it until the block lifts; it is never counted as
 * "In your wallet".
 *
 * Times are the scheduler's own (`nextPayoutAt`, `disputeHoldEndsAt`),
 * never a clock rule worked out here. Null when the backend sends none of
 * the new fields (an older server): the page then keeps its earlier lines.
 */
export interface PayoutStage {
  readonly key: "recording" | "hold" | "ready" | "wallet" | "unpaid";
  readonly label: string;
  readonly amount: string;
  readonly calls: number | null;
  /** The figure is zero: shown dimmed, so the four stages always read in order. */
  readonly empty: boolean;
  /** A sentence under the figure (the unpaid line says why and what happens next). */
  readonly note?: string;
}

function isPositive(money: Money | null | undefined): boolean {
  return Boolean(money?.amount && BigInt(money.amount) > 0n);
}

/** Whether this backend reports the payout stages at all. */
export function hasPayoutStages(state: ProviderPayoutState | null | undefined): boolean {
  return state?.awaitingSettlement !== undefined || state?.readyForPayout !== undefined || state?.inDisputeHold !== undefined;
}

/** Whether the stages carry the hold figure, so they may replace the older "Held in the dispute window" line. */
export function stagesReplaceHeldLine(state: ProviderPayoutState | null | undefined): boolean {
  return state?.inDisputeHold !== undefined;
}

/** "about 14:00 UTC", or null when the instant is unknown. */
export function aboutTime(at: string | null | undefined, now: number): string | null {
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return `about ${formatDateTime(at, { now, midSentence: true })}`;
}

/**
 * `state` is the top level of `GET /providers/me/earnings` (API-W2 §3.2);
 * `inWallet` the month's figure the page already shows.
 */
export function payoutStages(
  state: ProviderPayoutState | null | undefined,
  inWallet: Money | null,
  format: (value: Money | null) => string,
  now: number = Date.now(),
): PayoutStage[] | null {
  if (!state || !hasPayoutStages(state)) return null;
  // `disputeHoldEndsAt` is the EARLIEST end: with more than one call held, it is when the first one ends.
  const holdEnds = state.disputeHoldEndsAt ?? null;
  const holdCalls = state.inDisputeHoldCalls ?? 0;
  const holdTime = holdEnds && Date.parse(holdEnds) > now ? formatDateTime(holdEnds, { now, midSentence: true }) : null;
  const holdLabel = !holdTime
    ? "In the dispute hold"
    : holdCalls > 1
      ? `In the dispute hold, the first until ${holdTime}`
      : `In the dispute hold until ${holdTime}`;
  const nextPayout = aboutTime(state.nextPayoutAt, now);
  const stage = (
    key: PayoutStage["key"],
    label: string,
    money: Money | null | undefined,
    calls: number | null | undefined,
  ): PayoutStage => ({
    key,
    label,
    // `null` money is unknown (several assets, none named), never zero.
    amount: money ? format(money) : "—",
    calls: calls ?? null,
    empty: !isPositive(money),
  });
  return [
    stage("recording", "Passed, being recorded on chain", state.awaitingSettlement, state.awaitingSettlementCalls),
    stage("hold", holdLabel, state.inDisputeHold, state.inDisputeHoldCalls),
    stage(
      "ready",
      nextPayout ? `Ready, paid in the next payout (${nextPayout})` : "Ready, paid in the next payout",
      state.readyForPayout,
      state.readyForPayoutCalls,
    ),
    stage("wallet", "In your wallet", inWallet, null),
    ...unpaidStages(state, format, now),
  ];
}

/**
 * The unpaid lines: one per asset with unpaid payouts, every asset whatever
 * the page reads (frontend L-6); an older server without `unpaidByAsset`
 * gives its single `unpaid` figure.
 */
function unpaidStages(
  state: ProviderPayoutState,
  format: (value: Money | null) => string,
  now: number,
): PayoutStage[] {
  const perAsset = (state.unpaidByAsset ?? []).filter((row) => isPositive(row.amount));
  if (perAsset.length > 0) {
    return perAsset.map((row) => unpaidStage(row.amount, row.since, format, now, perAsset.length > 1));
  }
  return isPositive(state.unpaid) ? [unpaidStage(state.unpaid ?? null, state.unpaidSince ?? null, format, now, false)] : [];
}

/**
 * The unpaid line: paid out, but the token issuer blocked the transfer to the
 * payout address, so the escrow keeps it. Not in the wallet.
 */
function unpaidStage(
  amount: Money | null,
  unpaidSince: string | null,
  format: (value: Money | null) => string,
  now: number,
  several: boolean,
): PayoutStage {
  const since =
    unpaidSince && !Number.isNaN(Date.parse(unpaidSince))
      ? ` since ${formatDateTime(unpaidSince, { now, alwaysDay: true, midSentence: true })}`
      : "";
  return {
    key: "unpaid",
    label: `Not paid yet${several ? " in this token" : ""}: blocked by the token issuer${since}`,
    amount: amount ? format(amount) : "—",
    calls: null,
    empty: false,
    note:
      "The token's issuer blocked transfers to your payout address, so this payout did not reach your wallet. " +
      "It is kept for you in the escrow and paid to you after Assay claims it, once the issuer lifts the block.",
  };
}

/* ------------------------------------------------------------ payout cadence */

/** The two cadences, in the order the setting lists them (SPEC-W2 §8). */
export const PAYOUT_CADENCES: readonly PayoutCadence[] = ["EVERY_6_HOURS", "HOURLY"];

/** The option's words. `minimum` is the hourly floor, e.g. "$25.00"; "$25" until read. */
export function cadenceLabel(cadence: PayoutCadence, minimum: string | null = null): string {
  return cadence === "HOURLY"
    ? `Every hour, only when at least ${minimum ?? "$25"} is ready (otherwise in the 6-hour run)`
    : "Every 6 hours (default)";
}

/** What the hourly reason needs: the schedule's cadence and floor, and the ready figure from the earnings. */
export interface HourlyWaitInputs {
  readonly cadence: PayoutCadence;
  /** `hourlyMinimum` of `GET /providers/me/payout-cadence`; null when the server names none. */
  readonly minimum: Money | null | undefined;
  /** `readyForPayout` of `GET /providers/me/earnings`; null or absent when unknown. */
  readonly ready: Money | null | undefined;
}

const HOUR_MS = 3_600_000;

/**
 * Why an hourly schedule shows a later run (BUG-R2-PRV-02): with `HOURLY`
 * the next run is the next hour only once the hourly minimum is ready;
 * below it the money waits for the 6-hour run. Said only when the shown run
 * is more than an hour away and the ready figure is not known to have
 * reached the minimum. Names the minimum when the server sends one. Pure.
 */
export function hourlyWaitReason(
  nextPayoutAt: string | null | undefined,
  inputs: HourlyWaitInputs | null | undefined,
  format: (value: Money | null) => string,
  now: number = Date.now(),
): string | null {
  if (!inputs || inputs.cadence !== "HOURLY" || !nextPayoutAt) return null;
  const at = Date.parse(nextPayoutAt);
  if (Number.isNaN(at) || at - now <= HOUR_MS) return null;
  const { minimum, ready } = inputs;
  const comparable = minimum && ready && minimum.asset === ready.asset && minimum.decimals === ready.decimals;
  if (comparable && BigInt(ready.amount) >= BigInt(minimum.amount)) return null;
  return minimum && isPositive(minimum)
    ? `hourly payouts start once at least ${format(minimum)} is ready`
    : "hourly payouts start once enough is ready";
}

/**
 * "Next payout about 18:00 UTC", or null when no run is planned or the server
 * does not say. With `hourly`, a later run on the hourly schedule says why:
 * "Next payout about 18:00 UTC (hourly payouts start once at least $25.00 is ready)".
 */
export function nextPayoutLine(
  nextPayoutAt: string | null | undefined,
  now: number = Date.now(),
  hourly?: { inputs: HourlyWaitInputs; format: (value: Money | null) => string },
): string | null {
  const about = aboutTime(nextPayoutAt, now);
  if (!about) return null;
  const reason = hourly ? hourlyWaitReason(nextPayoutAt, hourly.inputs, hourly.format, now) : null;
  return reason ? `Next payout ${about} (${reason})` : `Next payout ${about}`;
}

/** Said beside the setting: what it covers and when a change applies. */
export const CADENCE_NOTE =
  "Applies to per-call payments and idle channels; an active channel is paid before each settle. A change applies from the next run.";

/**
 * The payment row's headline (SPEC-W2 §11): "Paid for 12 calls (from 3
 * buyers) in one transfer". Older servers send no buyer count: the buyers
 * part is left out rather than guessed; without a real transaction ref the
 * "in one transfer" part is left out too, and without a count it is "Paid for
 * calls".
 */
export function paymentRowTitle(payout: Pick<ProviderPayout, "calls" | "buyers" | "chainTxRef">, isTransaction: boolean): string {
  if (payout.calls == null) return "Paid for calls";
  const calls = `${payout.calls.toLocaleString("en-US")} ${payout.calls === 1 ? "call" : "calls"}`;
  const buyers =
    payout.buyers != null && payout.buyers > 0
      ? ` (from ${payout.buyers.toLocaleString("en-US")} ${payout.buyers === 1 ? "buyer" : "buyers"})`
      : "";
  // "In one transfer" only when there is a transaction to check it against.
  return `Paid for ${calls}${buyers}${isTransaction ? " in one transfer" : ""}`;
}
