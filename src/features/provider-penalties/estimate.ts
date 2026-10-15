import Decimal from "decimal.js";

import type { Money } from "@/interfaces";

/**
 * A penalty estimate from inputs, with the backend's formula
 * (`sla-window.service.ts` / `sla-statistics.ts`):
 *
 *     penalty = min( totalCallAmount × (observedRate − declaredRate) × multiplier,
 *                    max($5, 100 × price) )
 *
 * `multiplier` is `SLA_PENALTY_MULTIPLIER` (2). The per-window cap
 * `max($5, 100 × price)` is enforced on chain. A further cap of 10% of the
 * stake per provider per day also exists; it can only lower the result, so an
 * estimate without it is an upper bound and is labelled "about".
 *
 * There is no window volume on the wire before a tool is live, so the caller
 * states the one it assumes (`calls`).
 */
export const PENALTY_MULTIPLIER = 2;
export const PENALTY_CAP_FLOOR = 5;
export const PENALTY_CAP_PRICE_MULTIPLE = 100;

export interface PenaltyEstimate {
  /** What is taken from the stake, after the per-window cap. Zero when within the promise. */
  penalty: Money;
  /** The formula result before the cap. */
  uncapped: Money;
  /** The per-window cap. */
  cap: Money;
  capped: boolean;
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
  const raw = total.mul(excess).mul(multiplier);
  const cap = Decimal.max(new Decimal(PENALTY_CAP_FLOOR), unit.mul(PENALTY_CAP_PRICE_MULTIPLE));
  const taken = Decimal.min(raw, cap);
  return {
    penalty: toMoney(taken, price),
    uncapped: toMoney(raw, price),
    cap: toMoney(cap, price),
    capped: raw.gt(cap),
  };
}

/**
 * The failure rate the wizard's example uses: 12%, or 5 points over the
 * promise when the promise is already at or above 12%.
 */
export function exampleFailureRate(declaredRate: number): number {
  return declaredRate < 0.12 ? 0.12 : Math.min(1, Number((declaredRate + 0.05).toFixed(4)));
}
