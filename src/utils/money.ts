import Decimal from "decimal.js";

import type { Money } from "@/interfaces";

/**
 * Money arrives as minor units in a string plus a scale (`{ amount: "4990000",
 * decimals: 6 }` is $4.99). Everything here goes through decimal.js and back to
 * a string; no amount is ever a JS number, because the design system requires that
 * "money must align on the decimal" and a float cannot promise that.
 */

/** Minor units -> a Decimal in major units. */
export function toDecimal(money: Money): Decimal {
  return new Decimal(money.amount || "0").div(new Decimal(10).pow(money.decimals));
}

export interface FormatMoneyOptions {
  /**
   * The MOST fraction digits to show. Display always follows one rule (see
   * `formatDecimal`): two decimals, more only when the value has them. A
   * per-call price passes 4 or 6 so `$0.0016` survives; a balance leaves it at 2.
   */
  decimals?: number;
  /** Prefix. Defaults to "$". */
  symbol?: string;
  /** Thousands separators. On by default, as the design's "14,760" shows. */
  grouped?: boolean;
  /**
   * Exactly `decimals` places, no trimming and no widening — for CSV exports
   * and raw details, where the figure must be the ledger's own.
   */
  exact?: boolean;
}

/** Past this, a computed Decimal (a division) is noise, not precision. */
const MAX_SUBUNIT_PLACES = 8;

/**
 * **The one display rule for money on this platform.**
 *
 * 1. Two decimals by default: `$12.40`, `$2.50`.
 * 2. More decimals only when the value has them, up to `decimals`, with the
 *    trailing zeros past the second dropped: `$0.0120` is `$0.012`,
 *    `$2.5000` is `$2.50`, `$0.0016` stays `$0.0016`.
 * 3. A value that is not zero never reads as zero: below the requested
 *    precision it is written out to its own precision (`$0.000001`, `$0.005`).
 *    Zero is `$0.00`.
 *
 * Exact values (CSV exports, raw details) do not come through here.
 *
 * **Truncate, never round** (`Decimal.ROUND_DOWN`, spelled once, here).
 * $9.965 is `$9.96` and $34.965 is `$34.96` — on every screen, in every
 * direction. A displayed figure that is never larger than the figure behind it
 * cannot promise money that is not there: a balance shown as `$9.97` when the
 * ledger holds 9.965 is a withdrawal request the chain refuses, and a price
 * shown rounded up is a charge nobody made.
 *
 * Takes a `Decimal` rather than a `Money` so the arithmetic screens — "balance
 * after this deposit" — reach the same code as the reading screens. `formatMoney`
 * is the `Money` front door and delegates here.
 */
export function formatDecimal(value: Decimal, options: FormatMoneyOptions = {}): string {
  const { decimals = 2, symbol = "$", grouped = true, exact = false } = options;
  const minPlaces = exact ? decimals : Math.min(2, decimals);

  let places = decimals;
  if (!exact && !value.isZero() && value.toDecimalPlaces(decimals, Decimal.ROUND_DOWN).isZero()) {
    places = Math.max(decimals, Math.min(value.decimalPlaces(), MAX_SUBUNIT_PLACES));
  }

  let fixed = value.toFixed(places, Decimal.ROUND_DOWN);
  if (places > minPlaces) {
    const [whole, fraction = ""] = fixed.split(".");
    let kept = fraction.replace(/0+$/, "");
    if (kept.length < minPlaces) kept = kept.padEnd(minPlaces, "0");
    fixed = kept ? `${whole}.${kept}` : whole;
  }
  if (!grouped) return `${symbol}${fixed}`;

  const [whole, fraction] = fixed.split(".");
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol}${withSeparators}${fraction ? "." + fraction : ""}`;
}

/** `Money` (minor units) through the one display rule above. Nothing is `$0.00`. */
export function formatMoney(money: Money | null | undefined, options: FormatMoneyOptions = {}): string {
  const { decimals = 2, symbol = "$" } = options;
  if (!money) return `${symbol}0.${"0".repeat(Math.min(2, decimals))}`;

  return formatDecimal(toDecimal(money), options);
}

/** True when the two sides differ — the counterfactual actually has a gap. */
export function differs(a: Money | null | undefined, b: Money | null | undefined): boolean {
  if (!a || !b) return Boolean(a) !== Boolean(b);
  return !toDecimal(a).eq(toDecimal(b));
}

/** listed − charged, i.e. what was not charged. Never negative. */
export function notCharged(listed: Money, charged: Money): Money {
  const diff = toDecimal(listed).minus(toDecimal(charged));
  const clamped = diff.isNegative() ? new Decimal(0) : diff;
  return {
    amount: clamped.mul(new Decimal(10).pow(listed.decimals)).toFixed(0),
    asset: listed.asset,
    decimals: listed.decimals,
  };
}

/**
 * The asset id is a chain-scoped string like
 * `solana:EtWT.../token:61Ci...`, which is not a symbol and must not be shown.
 * The MVP settles in one stablecoin, so "$" is correct everywhere today; when a
 * second asset lands, this is the one place that has to learn about it.
 */
export function symbolForAsset(_asset: string): string {
  return "$";
}

/**
 * True when `value` carries more precision than the asset can represent — a
 * seventh decimal place on a 6-decimal mint.
 *
 * Split out from `toAtomic` because the two answers are needed in different
 * places and at different times: a form needs this one *while the person is
 * still typing*, so it can refuse the amount in words, and `toAtomic` needs it
 * at the moment of conversion so that no caller can convert an amount it would
 * have to round. Same predicate, one definition.
 */
export function exceedsScale(value: Decimal, decimals: number): boolean {
  return value.decimalPlaces() > decimals;
}

/**
 * Major units -> minor units as a decimal string. The exact inverse of
 * `toDecimal`, and the form every money-moving API on this platform wants
 * (`POST /deposits` takes `/^[1-9][0-9]*$/`).
 *
 * **It refuses rather than rounds.** An amount with more decimal places than
 * the asset has is not a small problem to be tidied away — it is a number the
 * chain cannot move, and truncating it means the screen shows one figure while
 * a different one is signed. There is no rounding mode parameter for the same
 * reason: every value of it would be a way to lose the buyer's money quietly.
 *
 * **No multiplication, and no `Number` anywhere.**
 *
 * - `parseFloat(x) * 1e6` is wrong on ordinary money, not just exotic money:
 *   `$8.29` comes out as `8289999`. A double cannot hold two decimal digits
 *   exactly, so the error is in the input before any scaling happens.
 * - `value.times(new Decimal(10).pow(decimals))` is wrong too, just later:
 *   decimal.js rounds every arithmetic result to `Decimal.precision`
 *   significant digits (20 by default), so `123456789012345.678901` scales to
 *   `…678900` and drops its last digit. `notCharged` above multiplies and
 *   carries that ceiling; it is out of reach in practice at 6 decimals, but it
 *   is the reason this function does not follow the same pattern.
 *
 * `toFixed` writes the digits out at the asset's scale and the point is
 * deleted, so nothing is computed at all — and with `exceedsScale` already
 * refused above, `toFixed` has nothing left to round either.
 */
export function toAtomic(value: Decimal, decimals: number): string {
  if (exceedsScale(value, decimals)) {
    throw new RangeError(
      `toAtomic: ${value.toString()} has ${value.decimalPlaces()} decimal places, ` +
        `which is more than the asset's ${decimals}. Refusing to round it.`,
    );
  }

  // The sign is carried around the digit surgery rather than through it: a bare
  // `replace(/^0+(?=\d)/, "")` never matches a string starting with "-", so
  // "-0.5" would keep its leading zero and produce "-0500000". Unreachable from
  // a form that forbids "-", but this is a shared utility now.
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith("-");
  const digits = (negative ? fixed.slice(1) : fixed).replace(".", "").replace(/^0+(?=\d)/, "");
  return negative && digits !== "0" ? `-${digits}` : digits;
}

export interface ParsedAmount {
  /** The amount, when valid. */
  value: Decimal | null;
  /** Minor units for the API (`toAtomic`), when valid. */
  atomic: string | null;
  /** One sentence for the field, when not valid (or empty and required). */
  error: string | null;
}

/**
 * What a person typed in an amount field → a validated amount, or one
 * sentence saying what is wrong. Use it for every amount input (PresetChips'
 * Custom field included), so every form refuses the same things in the same words.
 *
 *   parseAmountInput("20", { decimals: 6, min: "5" })   → { value: 20, atomic: "20000000", error: null }
 *   parseAmountInput("1.2.3", { decimals: 6 })          → { error: "Enter an amount like 20 or 20.50." }
 *   parseAmountInput("1,5", { decimals: 6 })            → { error: "Enter an amount like 20 or 20.50." }
 */
export function parseAmountInput(
  raw: string,
  options: { decimals: number; min?: string; max?: string; required?: boolean; symbol?: string },
): ParsedAmount {
  const { decimals, min, max, required = true, symbol = "$" } = options;
  // A leading "$" (pasted from a price) is fine; a comma only as a thousands
  // separator ("1,000"), never as a decimal point ("1,5" is not 15).
  const trimmed = raw.trim().replace(/^\$\s*/, "");
  if (trimmed === "") return { value: null, atomic: null, error: required ? "Enter an amount." : null };
  // The first group never starts with 0: "0,500" is a decimal comma, not 500.
  if (trimmed.includes(",") && !/^[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/.test(trimmed)) {
    return { value: null, atomic: null, error: "Enter an amount like 20 or 20.50." };
  }
  const text = trimmed.replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(text) || text === ".") {
    return { value: null, atomic: null, error: "Enter an amount like 20 or 20.50." };
  }
  const value = new Decimal(text);
  if (exceedsScale(value, decimals)) {
    return { value: null, atomic: null, error: `Use at most ${decimals} decimal places.` };
  }
  if (value.lte(0)) return { value: null, atomic: null, error: "Enter an amount above zero." };
  if (min !== undefined && value.lt(min)) {
    return { value: null, atomic: null, error: `The minimum is ${formatDecimal(new Decimal(min), { symbol })}.` };
  }
  if (max !== undefined && value.gt(max)) {
    return { value: null, atomic: null, error: `The most you can use here is ${formatDecimal(new Decimal(max), { symbol })}.` };
  }
  return { value, atomic: toAtomic(value, decimals), error: null };
}

/**
 * Parts of one total, each cut to `places` decimals for display, so that the
 * parts shown add up to the total shown — largest remainder: every part is
 * truncated (as `formatMoney` does), and the cents the truncation lost from
 * the total go one each to the parts that lost the most.
 *
 *   $28.47 at 60 / 30 / 10 → 17.082, 8.541, 2.847 → $17.08 + $8.54 + $2.85 = $28.47
 *
 * The parts share one asset and scale; amounts must be whole minor units.
 * Returned in the input order. Display only: what moves on chain is the
 * exact figure, never this one.
 */
export function splitForDisplay(parts: readonly Money[], places: number = 2): Money[] {
  if (parts.length === 0) return [];
  const decimals = parts[0]!.decimals;
  if (parts.some((part) => part.decimals !== decimals || !/^\d+$/.test(part.amount)) || places >= decimals) return [...parts];
  const unit = BigInt(10) ** BigInt(decimals - places);
  const amounts = parts.map((part) => BigInt(part.amount));
  const total = amounts.reduce((sum, value) => sum + value, BigInt(0)) / unit;
  const floors = amounts.map((value) => value / unit);
  let left = total - floors.reduce((sum, value) => sum + value, BigInt(0));
  const order = amounts
    .map((value, index) => ({ index, remainder: value % unit }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const { index } of order) {
    if (left <= BigInt(0)) break;
    floors[index] = floors[index]! + BigInt(1);
    left -= BigInt(1);
  }
  return parts.map((part, index) => ({ ...part, amount: (floors[index]! * unit).toString() }));
}
