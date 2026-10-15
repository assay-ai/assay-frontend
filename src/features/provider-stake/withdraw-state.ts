import type { Money, ProviderChainStake } from "@/interfaces";
import { toDecimal } from "@/utils/money";

/**
 * Where a withdrawal stands, from the stake wallet's chain entry:
 *
 *   none        nothing is unbonding — the sheet offers "Start withdrawing"
 *   unbonding   a clock is running — shows its end date; a new request
 *               restarts it for the whole unbonding balance
 *   ready       the clock has ended — "Withdraw $X to your wallet"
 */
export type WithdrawPhase = "none" | "unbonding" | "ready";

export interface WithdrawState {
  phase: WithdrawPhase;
  staked: Money | null;
  unbonding: Money | null;
  startedAt: string | null;
  completesAt: string | null;
  /** Unbonding period, in ms, when a running clock shows it; null otherwise. */
  periodMs: number | null;
}

function positive(money: Money | null | undefined): Money | null {
  return money && toDecimal(money).gt(0) ? money : null;
}

export function withdrawStateOf(entry: ProviderChainStake | null | undefined, now = Date.now()): WithdrawState {
  const unbonding = positive(entry?.unbonding);
  const completesAt = entry?.unbondingCompletesAt ?? null;
  const startedAt = entry?.unbondingStartedAt ?? null;
  let periodMs: number | null = null;
  if (startedAt && completesAt) {
    const gap = new Date(completesAt).getTime() - new Date(startedAt).getTime();
    periodMs = Number.isFinite(gap) && gap > 0 ? gap : null;
  }
  const phase: WithdrawPhase = !unbonding
    ? "none"
    : completesAt && new Date(completesAt).getTime() <= now
      ? "ready"
      : "unbonding";
  return { phase, staked: positive(entry?.staked), unbonding, startedAt, completesAt, periodMs };
}

/** When a request made now would mature, if the period is known. */
export function availableAfterRequest(state: WithdrawState, now = Date.now()): string | null {
  return state.periodMs ? new Date(now + state.periodMs).toISOString() : null;
}

/** "7 days" — the unbonding period in words, when known. */
export function periodLabel(periodMs: number | null): string | null {
  if (!periodMs) return null;
  const days = Math.round(periodMs / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.round(periodMs / 3_600_000));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * The contract's minimum unbonding period (`MIN_UNBONDING_PERIOD_SECONDS`,
 * eleven days). The live period is a chain parameter the console cannot read
 * yet; until a withdrawal is running (which shows the real dates), this is
 * the honest lower bound to quote.
 */
export const MIN_UNBONDING_MS = 11 * 86_400_000;

/**
 * The waiting period, from the best source there is, said one way everywhere
 * (Setup's end screen, the Withdraw sheet, the Stake page):
 *
 *  1. a running withdrawal's own clock (`periodMs`) — exact;
 *  2. the published provider terms ("Unbonding · 14 days") — exact;
 *  3. the contract minimum — a lower bound, so it is always "at least".
 */
export interface WaitingPeriod {
  ms: number;
  /** False when only the contract minimum is known. */
  exact: boolean;
}

const DAY_MS = 86_400_000;

export function waitingPeriodOf(
  periodMs: number | null,
  terms?: { commercialTerms: { key: string; label: string; value: string }[] } | null,
): WaitingPeriod {
  if (periodMs) return { ms: periodMs, exact: true };
  const term = terms?.commercialTerms.find((entry) => /unbond|waiting/i.test(`${entry.key} ${entry.label}`));
  const days = term ? /(\d+(?:\.\d+)?)\s*day/i.exec(term.value) : null;
  if (days && Number(days[1]) > 0) return { ms: Number(days[1]) * DAY_MS, exact: true };
  return { ms: MIN_UNBONDING_MS, exact: false };
}

/** "14 days", or "at least 11 days" when only the minimum is known. */
export function waitingDuration(period: WaitingPeriod): string {
  const label = periodLabel(period.ms) ?? "";
  return period.exact ? label : `at least ${label}`;
}

/** "a 14-day waiting period", or "a waiting period of at least 11 days". */
export function waitingPeriodPhrase(period: WaitingPeriod): string {
  if (!period.exact) return `a waiting period of ${waitingDuration(period)}`;
  const label = periodLabel(period.ms) ?? "";
  return `a ${label.replace(/ (day|hour)s?$/, "-$1")} waiting period`;
}

export interface WithdrawPlan {
  /** What can leave without pausing a paid tool or touching penalty reserves. Null when unknown. */
  free: Money | null;
  /** Held for open (pending or disputed) penalties. */
  reserved: Money | null;
  /** Per paid tool, highest requirement first: the stake below which it stops taking paid calls. */
  thresholds: { toolId: string; bindingId: string; minimum: Money }[];
}

const atomic = (money: Money | null | undefined): bigint => (money ? BigInt(money.amount || "0") : 0n);

/**
 * Withdraw planning, in atomic units:
 *   free = staked − required − reserved   (never below zero)
 * `required` is the account requirement (the `max` over paid tools, as the API
 * computes it), and `reserved` the sum of open penalties, which the chain holds
 * back from any withdrawal anyway.
 */
export function withdrawPlan(input: {
  staked: Money | null;
  required: Money | null;
  reserved: readonly Money[];
  requirement: readonly { toolId: string; bindingId: string; minimum: Money | null }[];
}): WithdrawPlan {
  const { staked, required } = input;
  const reservedAtomic = input.reserved.reduce((sum, item) => sum + atomic(item), 0n);
  const like = staked ?? required ?? input.reserved[0] ?? null;
  const reserved = like && reservedAtomic > 0n ? { ...like, amount: reservedAtomic.toString() } : null;
  let free: Money | null = null;
  if (staked) {
    const value = atomic(staked) - atomic(required) - reservedAtomic;
    free = { ...staked, amount: (value > 0n ? value : 0n).toString() };
  }
  const thresholds = input.requirement
    .filter((item): item is { toolId: string; bindingId: string; minimum: Money } => Boolean(item.minimum && atomic(item.minimum) > 0n))
    .map((item) => ({ toolId: item.toolId, bindingId: item.bindingId, minimum: item.minimum }))
    .sort((a, b) => (atomic(b.minimum) > atomic(a.minimum) ? 1 : atomic(b.minimum) < atomic(a.minimum) ? -1 : 0));
  return { free, reserved, thresholds };
}

/** The paid tools that stop taking paid calls if `remaining` stake is left. */
export function toolsPausedAt(plan: WithdrawPlan, remainingAtomic: bigint): WithdrawPlan["thresholds"] {
  return plan.thresholds.filter((item) => remainingAtomic < atomic(item.minimum));
}
