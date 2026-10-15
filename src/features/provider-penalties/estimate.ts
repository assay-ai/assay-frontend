import Decimal from "decimal.js";

import type { Money } from "@/interfaces";

/**
 * A penalty estimate from inputs, with the backend's formula
 * (`sla-window.ts` `penaltyFor`):
 *
 *     penalty = totalCallAmount × (observedRate − declaredRate) × multiplier
 *
 * `multiplier` is `SLA_PENALTY_MULTIPLIER` (2).
 *
 * What the chain enforces on top (X402Stake `proposeSlash`/`executeSlash`):
 * each penalty is at most a fixed maximum set on chain (`penaltyAmount`), and
 * penalties take at most a set share of the stake per rolling 24 hours
 * (`slashCapBps`). Both can only lower the result, and neither is known here,
 * so the estimate is an upper bound and is labelled "about".
 *
 * There is NO per-window cap such as max($5, 100 × price): an earlier version
 * applied one here and called it "enforced on chain", but neither the
 * contracts nor the backend apply it (provider review 2026-10-16b, P0).
 *
 * There is no window volume on the wire before a tool is live, so the caller
 * states the one it assumes (`calls`).
 */
export const PENALTY_MULTIPLIER = 2;

export interface PenaltyEstimate {
  /** The formula result: the most this window could take, before the chain's limits. Zero within the promise. */
  penalty: Money;
}

function scale(money: Pick<Money, "decimals">): Decimal {
  return new Decimal(10).pow(money.decimals);
}

function toMoney(value: Decimal, like: Money): Money {
  return {
    amount: Decimal.max(value, 0).mul(scale(like)).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0),
    asset: like.asset,
    decimals: like.decimals,
  };
}

export function estimatePenalty({
  price,
  calls,
  observedRate,
  declaredRate,
  multiplier = PENALTY_MULTIPLIER,
}: {
  /** Price per call. */
  price: Money;
  /** Paid calls in the window. */
  calls: number;
  /** e.g. 0.12 for 12%. */
  observedRate: number;
  /** e.g. 0.03 for 3%. */
  declaredRate: number;
  multiplier?: number;
}): PenaltyEstimate {
  const unit = new Decimal(price.amount || "0").div(scale(price));
  const total = unit.mul(calls);
  const excess = Decimal.max(new Decimal(observedRate).minus(declaredRate), 0);
  return { penalty: toMoney(total.mul(excess).mul(multiplier), price) };
}

/**
 * The failure rate the wizard's example uses: 12%, or 5 points over the
 * promise when the promise is already at or above 12%.
 */
export function exampleFailureRate(declaredRate: number): number {
  return declaredRate < 0.12 ? 0.12 : Math.min(1, Number((declaredRate + 0.05).toFixed(4)));
}
