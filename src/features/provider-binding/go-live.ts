import Decimal from "decimal.js";

import { DAILY_CAP_PERCENT } from "@/features/explorer/provider-economics";
import { estimatePenalty, exampleFailureRate } from "@/features/provider-penalties/estimate";
import { MIN_CHECKED_CALLS } from "@/features/provider-sla/reading";
import type { Money, PricingMode, ProviderStake, ProviderTermsSummary } from "@/interfaces";
import { formatMoney } from "@/utils/money";

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
  { value: "free", mode: "FREE", label: "Free", hint: "No revenue, no stake needed. It serves free calls only." },
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

/** The window volume the penalty example assumes; nothing is on the wire before a tool is live. */
export const EXAMPLE_WINDOW_CALLS = 1000;

/**
 * The worked penalty example at this listing's own price and promise, for Go
 * live and Settings: "Example: at 4% failures in a window of 1,000 paid
 * calls, up to about $X of your stake could be taken. …". Null for a free
 * listing or without a price or promise. The formula is the backend's
 * (`estimatePenalty`), and the caps are the stake rule's.
 */
export function penaltyExample(price: Money | null, mode: PricingMode, declaredRate: number | null): string | null {
  if (mode === "FREE" || !price || declaredRate === null) return null;
  const observed = exampleFailureRate(declaredRate);
  const estimate = estimatePenalty({ price, calls: EXAMPLE_WINDOW_CALLS, observedRate: observed, declaredRate });
  return (
    `Example: at ${percentText(observed)}% failures in a window of ${EXAMPLE_WINDOW_CALLS.toLocaleString("en-US")} paid calls, ` +
    `up to about ${formatMoney(estimate.penalty)} of your stake could be taken. The chain never lets penalties take more ` +
    `than ${DAILY_CAP_PERCENT}% of your stake in any 24 hours. Within your promise, or below ${MIN_CHECKED_CALLS} checked ` +
    `calls in a window, nothing is taken.`
  );
}

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

/**
 * What a price change on a live tool does to the stake: the total needed
 * before and after (the rule is "max" across tools), and how much is missing
 * once the new price applies. Shown in the Settings confirm, so raising a
 * price never quietly stops paid calls.
 */
export interface StakeEffect {
  before: Money | null;
  after: Money | null;
  shortfall: Money | null;
}

export function stakeEffectOf(input: {
  binding: { id: string; price: Money; pricingMode: PricingMode };
  price: Money | null;
  mode: PricingMode;
  stake: ProviderStake | null | undefined;
  staked: Money | null | undefined;
}): StakeEffect {
  const rule = stakeRuleOf(input.stake);
  const { binding } = input;
  const before = totalStakeWith(stakeNeededFor(binding.price, binding.pricingMode, rule), input.stake, binding.id);
  const after = totalStakeWith(stakeNeededFor(input.price, input.mode, rule), input.stake, binding.id);
  const gap = after ? major(after).minus(input.staked ? major(input.staked) : 0) : null;
  const shortfall = after && gap && gap.gt(0) ? fromMajor(gap, after) : null;
  return { before, after, shortfall };
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

/** The words both free-call boxes use when a value is refused, so the two read alike. */
const FREE_CALLS_COPY = {
  whole: "A whole number of calls, like 100.",
  atLeast: "At least 1 call.",
  atMost: (max: number) => `At most ${max.toLocaleString("en-US")} calls.`,
} as const;

/** Free calls per agent per day: a whole number from 1 to 1,000,000. */
export function freeCallsFromInput(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return { value: null, error: "Enter how many free calls each agent gets a day." };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: FREE_CALLS_COPY.whole };
  const value = Number(trimmed);
  if (value < 1) return { value: null, error: FREE_CALLS_COPY.atLeast };
  if (value > 1_000_000) return { value: null, error: FREE_CALLS_COPY.atMost(1_000_000) };
  return { value, error: null };
}

/** Highest value the backend accepts for `freeDailyBudget` (an int4). */
const MAX_FREE_CALLS_PER_DAY = 2_147_483_647;

/**
 * Free calls per day, all agents (`freeDailyBudget`): empty is the platform
 * default (`null`), otherwise a whole number of calls, with the same words as
 * the per-agent box.
 */
export function freeBudgetFromInput(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return { value: null, error: null };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: FREE_CALLS_COPY.whole };
  const value = Number(trimmed);
  if (value < 1) return { value: null, error: `${FREE_CALLS_COPY.atLeast} Leave it empty for the platform default.` };
  if (value > MAX_FREE_CALLS_PER_DAY) return { value: null, error: FREE_CALLS_COPY.atMost(MAX_FREE_CALLS_PER_DAY) };
  return { value, error: null };
}

/**
 * A warning when the listing's daily free calls (all agents) are fewer than
 * one agent's: the per-agent number can then never be reached in full.
 */
export function freeBudgetWarning(budget: number | null, perAgent: number | null): string | null {
  if (budget === null || perAgent === null || budget >= perAgent) return null;
  const all = budget.toLocaleString("en-US");
  return (
    `Agents get at most ${all} free ${budget === 1 ? "call" : "calls"} a day in total, fewer than the ` +
    `${perAgent.toLocaleString("en-US")} each agent is offered.`
  );
}

/**
 * The hint under "Free calls per day, all agents", by how agents pay. As the
 * backend counts it (main, `FreeQuotaService`): only FREE and FREEMIUM
 * listings serve free calls, so only they count this cap. When it runs out, a
 * FREEMIUM listing offers the paid call at its price; a FREE listing has no
 * paid path, so the call goes to another provider of the tool with room, or
 * is refused until the reset. A PAID listing serves no free calls,
 * so the cap does nothing until the listing gets a free tier.
 */
export function freeBudgetHint(mode: PricingMode | ""): string {
  const base = "The most free calls this listing gives in a day, all agents together. Leave empty for the platform default. Resets at 00:00 UTC.";
  if (mode === "FREE") {
    return `${base} When they run out, this listing takes no more calls until the reset; agents' calls go to another provider of this tool, if one can take them.`;
  }
  if (mode === "PAID") return `${base} It applies only on Free or Free + paid; every call here is paid, so it is not used now.`;
  return `${base} When they run out, agents are offered the paid option at your price.`;
}

const MODE_WORDS: Record<PricingMode, string> = { FREE: "Free", FREEMIUM: "Free + paid", PAID: "Paid" };

/**
 * The save confirm's rows for how agents pay and the free calls, before →
 * after, for the fields the save sends.
 */
export function freeTermsChangeRows(
  binding: { pricingMode: PricingMode; freeQuotaPerAgent: number | null; freeDailyBudget: number | null },
  body: { pricingMode?: PricingMode; freeQuotaPerAgent?: number | null; freeDailyBudget?: number | null },
): { label: string; before: string; after: string }[] {
  const calls = (n: number | null, none: string) => (n === null ? none : `${n.toLocaleString("en-US")} ${n === 1 ? "call" : "calls"}`);
  const rows: { label: string; before: string; after: string }[] = [];
  if (body.pricingMode !== undefined && body.pricingMode !== binding.pricingMode) {
    rows.push({ label: "How agents pay", before: MODE_WORDS[binding.pricingMode], after: MODE_WORDS[body.pricingMode] });
  }
  if (body.freeQuotaPerAgent !== undefined) {
    rows.push({
      label: "Free calls per agent per day",
      before: calls(binding.freeQuotaPerAgent, "None"),
      after: calls(body.freeQuotaPerAgent, "None"),
    });
  }
  if (body.freeDailyBudget !== undefined) {
    rows.push({
      label: "Free calls per day, all agents",
      before: calls(binding.freeDailyBudget, "Platform default"),
      after: calls(body.freeDailyBudget, "Platform default"),
    });
  }
  return onlyChanged(rows);
}

/**
 * The confirm's before → after rows that really change: a row whose two sides
 * read the same ("Stake needed $450 → $450") says nothing and is left out.
 */
export function onlyChanged<Row extends { before: string; after: string }>(rows: Row[]): Row[] {
  return rows.filter((row) => row.before !== row.after);
}

/** Seconds as a provider thinks about a timeout → milliseconds. */
export function timeoutFromSeconds(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { value: null, error: "Seconds, like 10." };
  const ms = Math.round(Number(trimmed) * 1000);
  if (ms < 1 || ms > 120_000) return { value: null, error: "Between 0.001 and 120 seconds." };
  return { value: ms, error: null };
}

/**
 * The Go live stake explanation, in one place so the numbers can never
 * disagree with each other:
 *
 *   "This tool alone needs $300.00 (1,000 × $0.30)."
 *   "Your stake has to cover your largest paid tool, Market quote: $450.00;
 *    you have $600.00 ✓"
 *
 * `total` is the account-wide requirement once this tool is live. The rule is
 * `max` across tools, not a sum (`requirementRule`, see `totalStakeWith`), so
 * the copy names the largest tool rather than adding them up. `have` is what
 * is staked.
 */
const RECOMMENDED_FACTOR = new Decimal("1.5");

export interface StakeSummary {
  perTool: string;
  total: string;
  tone: "ok" | "short" | "unknown";
  /** Why "1,000 × your price". */
  exposure: string;
  /** The 1.5× cushion. */
  recommended: string;
}

export function stakeSummary({
  needed,
  total,
  have,
  price,
  rule,
  largestToolName,
}: {
  /** The name of the other tool whose requirement is the total, when it is not this one. */
  largestToolName?: string | null;
  needed: Money;
  total: Money | null;
  have: Money | null;
  price: Money;
  rule: StakeRule;
}): StakeSummary {
  const fmt = (value: Money) => formatMoney(value);
  const multiplier = rule.multiplier.toNumber().toLocaleString("en-US");
  const floorWins = major(needed).eq(rule.floor) && rule.multiplier.mul(major(price)).lt(rule.floor);
  const perTool = floorWins
    ? `This tool alone needs ${fmt(needed)} (the minimum for any paid tool).`
    : `This tool alone needs ${fmt(needed)} (${multiplier} × ${formatMoney(price, { decimals: 6 })}).`;

  const overall = total && major(total).gt(major(needed)) ? total : needed;
  const lead =
    overall === needed
      ? "That is all the stake you need"
      : `Your stake has to cover your largest paid tool${largestToolName ? `, ${largestToolName}` : ""}: ${fmt(overall)}`;
  let tail: string;
  let tone: StakeSummary["tone"];
  if (!have) {
    tail = "we could not read your stake yet";
    tone = "unknown";
  } else if (major(have).lte(0)) {
    tail = "you have none yet";
    tone = "short";
  } else if (major(have).gte(major(overall))) {
    tail = `you have ${fmt(have)} ✓`;
    tone = "ok";
  } else {
    tail = `you have ${fmt(have)}, ${fmt(fromMajor(major(overall).minus(major(have)), overall))} short`;
    tone = "short";
  }

  const exposure = `Why ${multiplier} × your price: your stake has to cover about ${multiplier} calls' worth of refunds to buyers if your API stops working, before anything else can happen. It stays yours unless you break your promise.`;
  // The same 1.5× cushion the Stake page calls "Recommended".
  const recommended = fromMajor(major(overall).mul(RECOMMENDED_FACTOR), overall);
  const recommendedLine = `We recommend ${fmt(recommended)} (1.5 × ${fmt(overall)}), so one penalty does not take you below the minimum and pause your paid tools.`;
  return { perTool, total: `${lead}; ${tail}.`, tone, exposure, recommended: recommendedLine };
}
