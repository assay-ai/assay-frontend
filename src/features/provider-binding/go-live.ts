import Decimal from "decimal.js";

import type { Money, PricingMode, ProviderStake, ProviderTermsSummary } from "@/interfaces";

/**
 * The arithmetic behind the wizard's "Go live" summary and the Settings
 * form: "Buyers pay $0.10 → you get $0.09. Needs $100 stake (you have $120 ✓)."
 *
 * Nothing here types a platform constant in as fact. The stake rule
 * `max(floor, multiplier × price)` is read out of any binding's derivation
 * line on `GET /providers/me/stake`, and the take rate out of the published
 * commercial terms; when neither is on the wire the current published terms
 * (floor $50, 1000 × price, 10%) are used and the caller labels them
 * "current terms".
 */

export type PriceChoice = "free" | "free-paid" | "paid";

export const PRICE_CHOICES: { value: PriceChoice; mode: PricingMode; label: string; hint: string }[] = [
  { value: "free", mode: "FREE", label: "Free", hint: "No revenue, no stake needed." },
  { value: "free-paid", mode: "FREEMIUM", label: "Free + paid", hint: "Each agent gets free calls a day, then pays." },
  { value: "paid", mode: "PAID", label: "Paid", hint: "Every call is paid." },
];

export function choiceOfMode(mode: PricingMode): PriceChoice {
  return mode === "FREE" ? "free" : mode === "FREEMIUM" ? "free-paid" : "paid";
}

export function modeOfChoice(choice: PriceChoice): PricingMode {
  return PRICE_CHOICES.find((entry) => entry.value === choice)!.mode;
}

/** The free calls each agent gets per day on a "Free + paid" listing, when nothing is set. */
export const DEFAULT_FREE_CALLS_PER_AGENT = 100;
/** The promised failure rate offered by default, in percent. */
export const DEFAULT_FAILURE_PERCENT = 2;

export interface StakeRule {
  floor: Decimal;
  multiplier: Decimal;
  /** False: the published defaults, not read from the wire. */
  fromServer: boolean;
}

const DERIVATION = /max\(floor\s+([\d.]+)\s*,\s*([\d.]+)\s*[×x]\s*([\d.]+)\)/i;

export function stakeRuleOf(stake: ProviderStake | null | undefined): StakeRule {
  for (const item of stake?.requirement ?? []) {
    const match = DERIVATION.exec(item.derivation ?? "");
    if (match) return { floor: new Decimal(match[1]!), multiplier: new Decimal(match[2]!), fromServer: true };
  }
  return { floor: new Decimal(50), multiplier: new Decimal(1000), fromServer: false };
}

function major(money: Money): Decimal {
  return new Decimal(money.amount || "0").div(new Decimal(10).pow(money.decimals));
}

function fromMajor(value: Decimal, like: { asset: string; decimals: number }): Money {
  return {
    amount: value.mul(new Decimal(10).pow(like.decimals)).toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0),
    asset: like.asset,
    decimals: like.decimals,
  };
}

/** The stake a paid listing at `price` needs on its own, or null for a free one. */
export function stakeNeededFor(price: Money | null, mode: PricingMode, rule: StakeRule): Money | null {
  if (mode === "FREE" || !price || major(price).lte(0)) return null;
  return fromMajor(Decimal.max(rule.floor, rule.multiplier.mul(major(price))), price);
}

/**
 * The total stake required once this listing is live: the rule is "max" across
 * listings, so it is the larger of what the others already need and this one.
 */
export function totalStakeWith(needed: Money | null, stake: ProviderStake | null | undefined, excludingBindingId?: string): Money | null {
  const others = (stake?.requirement ?? [])
    .filter((item) => item.bindingId !== excludingBindingId && item.minimum)
    .map((item) => item.minimum!);
  const all = needed ? [...others, needed] : others;
  if (all.length === 0) return null;
  return all.reduce((best, next) => (major(next).gt(major(best)) ? next : best));
}

export interface TakeRate {
  /** e.g. 0.1 for 10%. */
  rate: Decimal;
  fromServer: boolean;
}

export function takeRateOf(terms: ProviderTermsSummary | null | undefined): TakeRate {
  const term = terms?.commercialTerms?.find((entry) => /take.?rate|fee/i.test(entry.key));
  const match = term ? /([\d.]+)\s*%/.exec(term.value) : null;
  if (match) return { rate: new Decimal(match[1]!).div(100), fromServer: true };
  return { rate: new Decimal("0.1"), fromServer: false };
}

/** What the provider receives per paid call. */
export function providerShare(price: Money, take: TakeRate): Money {
  const share = major(price).mul(new Decimal(1).minus(take.rate));
  return {
    amount: share.mul(new Decimal(10).pow(price.decimals)).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0),
    asset: price.asset,
    decimals: price.decimals,
  };
}

/** "2" / "2.5" / "2%" → 0.02 / 0.025, or an error sentence. */
export function failureRateFromPercent(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim().replace(/%$/, "").trim();
  if (trimmed === "") return { value: null, error: "Enter a percentage, like 2." };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { value: null, error: "Enter a number, like 2 or 2.5." };
  const percent = Number(trimmed);
  if (percent <= 0) return { value: null, error: "More than 0%." };
  if (percent > 100) return { value: null, error: "At most 100%." };
  return { value: Number((percent / 100).toFixed(6)), error: null };
}

/** 0.02 → "2"; 0.025 → "2.5". */
export function percentText(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}

/** Free calls per agent per day: a whole number from 1 to 1,000,000. */
export function freeCallsFromInput(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return { value: null, error: "Enter how many free calls each agent gets a day." };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: "A whole number, like 100." };
  const value = Number(trimmed);
  if (value < 1) return { value: null, error: "At least 1." };
  if (value > 1_000_000) return { value: null, error: "At most 1,000,000." };
  return { value, error: null };
}

/** Seconds as a provider thinks about a timeout → milliseconds. */
export function timeoutFromSeconds(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { value: null, error: "Seconds, like 10." };
  const ms = Math.round(Number(trimmed) * 1000);
  if (ms < 1 || ms > 120_000) return { value: null, error: "Between 0.001 and 120 seconds." };
  return { value: ms, error: null };
}
