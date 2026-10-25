import Decimal from "decimal.js";

import type { ChainParams } from "@/interfaces/chain";
import { formatDecimal } from "@/utils/money";

/**
 * The provider landing's earnings calculator (`/why-list-here`), pure.
 *
 * The terms are the chain's, read from `GET /chains` (`Chain.params`) and
 * passed in as {@link EconomicsTerms}; nothing here keeps a copy:
 *  - platform fee: `takeRateBps` of each paid call;
 *  - stake per paid listing: max(`minimumStake`, 1000 × price) — the 1000×
 *    multiple is platform policy, not a chain value;
 *  - most taken per 24 h: `slashCapBps` of the stake. This is the one limit on
 *    what a penalty takes that the chain enforces (a rolling 24 h window in
 *    AssayStake), next to a fixed maximum per penalty (`penaltyAmount`). No
 *    per-window cap such as max($5, 100 × price) is enforced anywhere, so
 *    none is shown (provider review 2026-10-16b, P0).
 * A free listing earns nothing, posts no stake and cannot be penalised.
 * Paid calls are served only by staked listings (owner decision), so there is
 * one column, not an "unverified" path.
 */

export type ListingMode = "FREE" | "FREEMIUM" | "PAID";

/** Platform policy (`PROVIDER_MINIMUM_STAKE_MULTIPLE`), not a chain value. */
const STAKE_PRICE_MULTIPLE = new Decimal("1000");
const DAYS_PER_MONTH = new Decimal("30");

/** The chain's numbers the calculator needs, all known. */
export interface EconomicsTerms {
  /** `takeRateBps` as a share, `0.1`. */
  feeRate: Decimal;
  /** `minimumStake` in dollars, `50`. */
  stakeFloor: Decimal;
  /** `slashCapBps` as a share, `0.1`. */
  dailyCapShare: Decimal;
}

/** {@link EconomicsTerms} from the chain's params, or `null` while any of them is unknown. */
export function economicsTerms(params: ChainParams | null | undefined, decimals: number): EconomicsTerms | null {
  if (!params || params.takeRateBps === null || params.slashCapBps === null) return null;
  if (params.minimumStake === null || !/^\d+$/.test(params.minimumStake)) return null;
  return {
    feeRate: new Decimal(params.takeRateBps).div(10_000),
    stakeFloor: new Decimal(params.minimumStake).div(new Decimal(10).pow(decimals)),
    dailyCapShare: new Decimal(params.slashCapBps).div(10_000),
  };
}

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
  /** The most penalties can take in any 24 hours: the chain-enforced share of the stake. */
  worstPer24h: string | null;
  /** Days of earnings that add up to the stake, or null when it does not apply. */
  daysToCoverStake: string | null;
}

const usd = (value: Decimal, decimals = 2) => formatDecimal(value, { decimals });

/** Per-call amounts keep their sub-cent digits, without trailing zeros past the cent. */
function perCallUsd(value: Decimal): string {
  return usd(value, 6).replace(/(\.\d\d)(\d*?)0+$/, "$1$2");
}

/** `null` for a paid listing until the chain's terms are known (`terms`). */
export function economics(
  mode: ListingMode,
  price: Decimal | null,
  calls: Decimal | null,
  terms: EconomicsTerms | null,
): Economics | null {
  if (mode === "FREE") {
    return {
      mode,
      perCall: null,
      netPerMonth: usd(new Decimal(0)),
      stake: usd(new Decimal(0)),
      worstPer24h: null,
      daysToCoverStake: null,
    };
  }
  if (!price || !calls || !terms) return null;
  const fee = price.mul(terms.feeRate);
  const youGet = price.minus(fee);
  const net = youGet.mul(calls);
  const stake = Decimal.max(terms.stakeFloor, STAKE_PRICE_MULTIPLE.mul(price));
  const perDay = net.div(DAYS_PER_MONTH);
  return {
    mode,
    perCall: { price: perCallUsd(price), fee: perCallUsd(fee), youGet: perCallUsd(youGet) },
    netPerMonth: usd(net),
    stake: usd(stake),
    worstPer24h: usd(stake.mul(terms.dailyCapShare)),
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

/** "≈ 1.7 days of earnings", "≈ 2.5 years of earnings", or "more than 10 years of earnings" when absurd. */
export function coverTimeText(days: string): string {
  const n = new Decimal(days);
  if (n.gt(3650)) return "more than 10 years of earnings";
  if (n.gt(365)) {
    const years = n.div(365).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
    return `≈ ${years.toString()} ${years.eq(1) ? "year" : "years"} of earnings`;
  }
  const shown = n.toDecimalPlaces(1, Decimal.ROUND_UP);
  return `≈ ${shown.toString()} ${shown.eq(1) ? "day" : "days"} of earnings`;
}
