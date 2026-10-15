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
