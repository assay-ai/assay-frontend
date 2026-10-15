import Decimal from "decimal.js";

import { formatDecimal } from "@/utils/money";

/**
 * The provider landing's earnings calculator (`/why-list-here`), pure.
 *
 * Illustrative published terms; the live values are configurable on chain:
 *  - platform fee: 10% of each paid call (`PLATFORM_FEE_BPS`);
 *  - stake per paid listing: max($50, 1000 × price);
 *  - most a penalty can take per window: max($5, 100 × price);
 *  - most per 24 h: 10% of the stake.
 * A free listing earns nothing, posts no stake and cannot be penalised.
 * Paid calls are served only by staked listings (owner decision), so there is
 * one column, not an "unverified" path.
 */

export type ListingMode = "FREE" | "FREEMIUM" | "PAID";

export const FEE_RATE = new Decimal("0.10");
const STAKE_FLOOR = new Decimal("50");
const STAKE_PRICE_MULTIPLE = new Decimal("1000");
const WINDOW_CAP_FLOOR = new Decimal("5");
const WINDOW_CAP_PRICE_MULTIPLE = new Decimal("100");
const DAILY_CAP_SHARE = new Decimal("0.10");
const DAYS_PER_MONTH = new Decimal("30");

/** Bounds that keep the inputs sane: a price over $100 per call or a billion calls a month is a typo. */
export const MAX_PRICE = "100";
export const MAX_CALLS = 1_000_000_000;

export function parsePrice(raw: string): { value: Decimal | null; error: string | null } {
  const text = raw.trim().replace(/^\$/, "");
  if (text === "") return { value: null, error: "Enter your price per call, like 0.001." };
  if (!/^\d*\.?\d*$/.test(text) || text === ".") return { value: null, error: "Enter a number like 0.001." };
  const value = new Decimal(text);
  if (value.decimalPlaces() > 6) return { value: null, error: "Use at most 6 decimal places." };
  if (value.lte(0)) return { value: null, error: "Enter a price above zero, or choose Free." };
  if (value.gt(MAX_PRICE)) return { value: null, error: `Enter a price up to $${MAX_PRICE} per call.` };
  return { value, error: null };
}

export function parseCalls(raw: string): { value: Decimal | null; error: string | null } {
  const text = raw.trim().replace(/[,\s_]/g, "");
  if (text === "") return { value: null, error: "Enter how many calls you expect a month, like 100000." };
  if (!/^\d+$/.test(text)) return { value: null, error: "Enter a whole number like 100000." };
  const value = new Decimal(text);
  if (value.gt(MAX_CALLS)) return { value: null, error: "Enter at most 1,000,000,000 calls a month." };
  return { value, error: null };
}

export interface Economics {
  mode: ListingMode;
  /** Per call: what the buyer pays, the fee, what you receive. */
  perCall: { price: string; fee: string; youGet: string } | null;
  netPerMonth: string;
  stake: string;
  worstPerWindow: string | null;
  worstPer24h: string | null;
  /** Days of earnings that add up to the stake, or null when it does not apply. */
  daysToCoverStake: string | null;
}

const usd = (value: Decimal, decimals = 2) => formatDecimal(value, { decimals });

/** Per-call amounts keep their sub-cent digits, without trailing zeros past the cent. */
function perCallUsd(value: Decimal): string {
  return usd(value, 6).replace(/(\.\d\d)(\d*?)0+$/, "$1$2");
}

export function economics(mode: ListingMode, price: Decimal | null, calls: Decimal | null): Economics | null {
  if (mode === "FREE") {
    return {
      mode,
      perCall: null,
      netPerMonth: usd(new Decimal(0)),
      stake: usd(new Decimal(0)),
      worstPerWindow: null,
      worstPer24h: null,
      daysToCoverStake: null,
    };
  }
  if (!price || !calls) return null;
  const fee = price.mul(FEE_RATE);
  const youGet = price.minus(fee);
  const net = youGet.mul(calls);
  const stake = Decimal.max(STAKE_FLOOR, STAKE_PRICE_MULTIPLE.mul(price));
  const perDay = net.div(DAYS_PER_MONTH);
  return {
    mode,
    perCall: { price: perCallUsd(price), fee: perCallUsd(fee), youGet: perCallUsd(youGet) },
    netPerMonth: usd(net),
    stake: usd(stake),
    worstPerWindow: usd(Decimal.max(WINDOW_CAP_FLOOR, WINDOW_CAP_PRICE_MULTIPLE.mul(price))),
    worstPer24h: usd(stake.mul(DAILY_CAP_SHARE)),
    daysToCoverStake: perDay.gt(0) ? stake.div(perDay).toDecimalPlaces(1, Decimal.ROUND_UP).toString() : null,
  };
}

/** The setup link, carrying the visitor's numbers so they need not type them twice. */
export function setupHref(mode: ListingMode, price: string, calls: string): string {
  const params = new URLSearchParams();
  params.set("mode", mode.toLowerCase());
  if (mode !== "FREE" && parsePrice(price).value) params.set("price", price.trim());
  if (parseCalls(calls).value) params.set("calls", calls.trim().replace(/[,\s_]/g, ""));
  return `/provider/setup?${params.toString()}`;
}
