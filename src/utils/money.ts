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
   * Fraction digits. The design shows money at two very different precisions —
   * $12.40 for a balance, $0.0010 for a per-call price — so this is explicit at
   * every call site rather than guessed from the value.
   */
  decimals?: number;
  /** Prefix. Defaults to "$". */
  symbol?: string;
  /** Thousands separators. On by default, as the design's "14,760" shows. */
  grouped?: boolean;
}

/**
 * **The one rounding convention on this platform: truncate, never round.**
 *
 * `Decimal.ROUND_DOWN`, spelled once, here. $9.965 is `$9.96` and $34.965 is
 * `$34.96` — on every screen, in every direction, including the screens that
 * add two of those together.
 *
 * ## Why truncation and not half-up
 *
 * Either is defensible in isolation; disagreeing is not. Between the two, a
 * displayed figure that is never larger than the figure behind it is the one
 * that cannot promise money that is not there — a balance shown as `$9.97`
 * when the ledger holds 9.965 is a withdrawal request the chain refuses, and a
 * price shown rounded up is a charge nobody made. Down is the direction whose
 * error is always in the buyer's favour to discover.
 *
 * ## Why this function exists at all
 *
 * It was already the convention, implemented **three times**: here, and by two
 * hand-copied `money()` helpers in `funding/deposit/page.tsx` and
 * `funding/auto-top-up/page.tsx`. Three copies agree by coincidence, and
 * `/spend` had already broken step — `perCall` wrote
 * `toFixed(4, Decimal.ROUND_DOWN)` while the narrative sentence two hundred
 * lines below wrote `toFixed(4)`, which is decimal.js's default and is
 * ROUND_HALF_UP. Same screen, same quantity, two conventions, and no test
 * could see it because neither line had one. So there is one implementation
 * now, and a caller that wants a different convention has to say so where a
 * reviewer reads it.
 *
 * Takes a `Decimal` rather than a `Money` so the arithmetic screens — "balance
 * after this deposit" — reach the same code as the reading screens. `formatMoney`
 * is the `Money` front door and delegates here.
 */
export function formatDecimal(value: Decimal, options: FormatMoneyOptions = {}): string {
  const { decimals = 2, symbol = "$", grouped = true } = options;

  const fixed = value.toFixed(decimals, Decimal.ROUND_DOWN);
  if (!grouped) return `${symbol}${fixed}`;

  const [whole, fraction] = fixed.split(".");
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol}${withSeparators}${fraction ? "." + fraction : ""}`;
}

export function formatMoney(money: Money | null | undefined, options: FormatMoneyOptions = {}): string {
  const { decimals = 2, symbol = "$" } = options;
  if (!money) return `${symbol}0.${"0".repeat(decimals)}`;

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
