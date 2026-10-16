import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { formatDate } from "@/libs/utc-time";
import { chainLabel } from "@/utils/chain";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * Formatting helpers local to the buyer console screens. Nothing here re-implements `formatMoney`
 * — every one of them calls it, because money must never become a JS number.
 */

/**
 * A LIMIT, not a price. The design writes caps at two decimals ($0.50,
 * $10.00, $100.00), but a per-call ceiling can legitimately be smaller than a
 * cent, and rendering a real $0.0010 ceiling as "$0.00" would tell someone
 * their agent can spend nothing. So the scale widens only when it has to.
 */
export function formatLimit(money: Money | null | undefined): string {
  if (!money) return "—";
  const value = toDecimal(money);
  const decimals = !value.isZero() && value.abs().lt("0.01") ? 4 : 2;
  return formatMoney(money, { decimals });
}

/** A `Money` that also says which chain it is posted on. */
export interface ChainStake extends Money {
  /** CAIP-2. */
  chainId: string;
}

/** One rendered line of a per-chain stake figure. */
export interface StakeLine {
  chainId: string;
  /**
   * The chain, short — or `null` when there is only one and there is
   * therefore nothing to tell apart. One enabled chain is the common case and
   * has to keep reading exactly as it always has.
   */
  label: string | null;
  /** Already formatted. Never combined with another line's. */
  amount: string;
}

/**
 * Bonded stake as lines — **one per chain, never a sum**.
 *
 * $90 on Solana plus $40 on `eip155:4663` is not $130: a call settles on one
 * chain and is backed only by that chain's collateral, so a total advertises
 * protection no single call has. The two are different CAIP-19 assets, so
 * they cannot be compared to pick the lower either — a "lowest" across them
 * is an FX rate silently assumed to be 1, on the number a buyer decides
 * whether to trust a provider by.
 *
 * **An empty list is "we could not say"**, never "staked nothing" — an RPC
 * outage, an unproved stake authority, a provider staked in a mode this
 * deployment does not read. It returns no lines, and the caller draws its
 * absent state. That emptiness is the only thing that carries the meaning:
 * the field used to be nullable, and the `stake ? … : "—"` test that survived
 * the change could never reach its own fallback, because every array — the
 * empty one included — is truthy. It threw inside decimal.js instead.
 */
export function stakeLines(stake: readonly ChainStake[]): StakeLine[] {
  return stake.map((entry) => ({
    chainId: entry.chainId,
    label: stake.length > 1 ? chainLabel(entry.chainId) : null,
    amount: formatMoney(entry, { decimals: 2 }),
  }));
}

/** Per-call prices: up to four decimals, only as many as the price has ($0.0016, $0.012, $2.50). */
export function formatPrice(money: Money | null | undefined): string {
  if (!money) return "—";
  return formatMoney(money, { decimals: 4 });
}

/** Ratio of `used` to `cap`, 0–100, clamped. Returns null when there is no cap. */
export function percentOf(used: Money | null | undefined, cap: Money | null | undefined): number | null {
  if (!used || !cap) return null;
  const capValue = toDecimal(cap);
  if (capValue.isZero()) return null;
  const ratio = toDecimal(used).div(capValue).mul(100).toNumber();
  return Math.min(100, Math.max(0, ratio));
}

/**
 * "3d ago" / "just now". Deliberately coarse: the design writes durations, not
 * timestamps, in subtitles, and a second-accurate value would rerender
 * forever.
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const elapsed = now - then;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

/** "Jun 2" (or "Jun 2, 2025") — a date with no time, the UTC day. */
export function dateOnly(iso: string | null | undefined): string {
  return formatDate(iso);
}

/** Thousands-separated counts, as in the design's "512,900 calls measured". */
export function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US");
}

/**
 * A percentage measured on real traffic. Returns null rather than 0 when
 * nothing has been measured — a quality figure invented out of an empty
 * sample is worse than an absent one, and this product's whole claim is that
 * these numbers are observed rather than asserted.
 */
export function formatRate(passed: number, measured: number): string | null {
  if (measured <= 0) return null;
  return `${((passed / measured) * 100).toFixed(1)}%`;
}

/** UTC day bounds, for the "spent today" figure the daily meter needs. */
export function todayBounds(now = new Date()): { from: string; to: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** UTC calendar-month bounds, for the monthly meter. */
export function monthBounds(now = new Date()): { from: string; to: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * `a − b` in minor units, staying inside decimal.js the whole way. Both sides
 * must share a scale, which every Money on this API does within one asset.
 */
export function subtractMoney(a: Money, b: Money): Money {
  return {
    amount: new Decimal(a.amount || "0").minus(new Decimal(b.amount || "0")).toFixed(0),
    asset: a.asset,
    decimals: a.decimals,
  };
}
