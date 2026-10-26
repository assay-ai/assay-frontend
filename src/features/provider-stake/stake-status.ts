import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { formatDecimal, formatMoney, toDecimal } from "@/utils/money";

/**
 * Stake health, one rule for every screen that talks about it: Home, Stake,
 * the Inbox and the Add stake sheet (D21).
 *
 * `staked` is the FREE stake on EVM (stake minus pending penalties,
 * `freeBondedOf`, assay-evm D-26): a proposed penalty counts at once.
 *
 *   short    staked < minimum: paid calls are at risk now
 *   close    minimum ≤ staked < minimum × 1.2: covered, but a penalty could
 *            take you below it (the backend's headroom notice, same 20%)
 *   covered  staked ≥ minimum × 1.2
 *
 * plus `none` (no paid tool needs stake) and `unknown` (nothing read yet).
 */
export type StakeHealth = "unknown" | "none" | "short" | "close" | "covered";

/** `STAKE_HEADROOM_WARNING_RATIO` on the backend: the headroom notice fires inside this share of the minimum. */
export const STAKE_CLOSE_SHARE = 0.2;

export interface StakeStatusReading {
  health: StakeHealth;
  /** "Short", "Covered, close to the minimum", "Covered"; null when unknown or not needed. */
  label: string | null;
  /** One sentence, the same everywhere. */
  sentence: string;
  /** How far above the minimum (covered/close) or below it (short). */
  gap: Money | null;
}

function money(value: Decimal, like: Money): Money {
  return { amount: value.mul(new Decimal(10).pow(like.decimals)).toFixed(0, Decimal.ROUND_DOWN), asset: like.asset, decimals: like.decimals };
}

export function stakeStatus(input: {
  required: Money | null;
  staked: Money | null;
  recommended?: Money | null;
  /** From `useStakeStatus`: null while nothing is read. */
  enough: boolean | null;
}): StakeStatusReading {
  const { required, staked, recommended } = input;
  if (input.enough === null) return { health: "unknown", label: null, sentence: "", gap: null };
  if (!required) {
    const holds = staked ? toDecimal(staked).gt(0) : false;
    return {
      health: "none",
      label: null,
      sentence: holds
        ? "No paid tool needs stake right now. Paid tools will use it when they go live."
        : "No paid tool needs stake right now. Free tools go live without it.",
      gap: null,
    };
  }
  const have = staked ? toDecimal(staked) : new Decimal(0);
  const need = toDecimal(required);
  const minimum = formatMoney(required);
  if (have.lt(need)) {
    const gap = money(need.minus(have), required);
    return {
      health: "short",
      label: "Short",
      sentence: `Short: ${formatMoney(gap)} below the ${minimum} minimum. Pending penalties count against your stake. Add stake to keep paid calls running.`,
      gap,
    };
  }
  const gap = money(have.minus(need), required);
  const recommendedText =
    recommended && have.lt(toDecimal(recommended)) ? ` Recommended: ${formatMoney(recommended)}.` : "";
  // Exactly at the minimum is where a first paid tool starts: covered, said calmly (onboarding wave item 3).
  if (have.eq(need)) {
    return {
      health: "close",
      label: "Covered, at the minimum",
      sentence: `Covered: your stake is at the ${minimum} minimum. A proposed penalty counts against your stake at once and would take it below; a margin keeps paid calls running.${recommendedText}`,
      gap,
    };
  }
  if (have.lt(need.mul(1 + STAKE_CLOSE_SHARE))) {
    return {
      health: "close",
      label: "Covered, close to the minimum",
      sentence: `Covered, close to the minimum: ${formatMoney(gap)} above the ${minimum} minimum. A proposed penalty counts against your stake at once and could take you below it; keep your stake above the minimum.${recommendedText}`,
      gap,
    };
  }
  return {
    health: "covered",
    label: "Covered",
    sentence: `Covered: ${formatMoney(gap)} above the ${minimum} minimum.${recommendedText}`,
    gap,
  };
}

/**
 * The Add stake sheet's line about an amount: what it brings the stake to,
 * against the recommended figure ("Brings you to the recommended $150.00").
 */
export function stakeAfterSentence(after: Decimal | null, required: Money | null, recommended: Money | null): string | null {
  if (!after || !required) return null;
  const total = formatDecimal(after);
  if (recommended && after.gte(toDecimal(recommended))) {
    return after.eq(toDecimal(recommended))
      ? `Brings you to the recommended ${formatMoney(recommended)}.`
      : `Brings you to ${total}, above the recommended ${formatMoney(recommended)}.`;
  }
  if (after.lt(toDecimal(required))) return `Brings you to ${total}, still below the ${formatMoney(required)} minimum.`;
  return `Brings you to ${total}${recommended ? `; the recommended amount is ${formatMoney(recommended)}` : ""}.`;
}

/** What can reduce stake, in one sentence for every surface that says it. */
export const STAKE_REDUCED_ONLY_BY = "It stays yours; it is reduced only by a penalty that is upheld or not disputed.";
