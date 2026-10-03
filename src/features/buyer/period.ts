import Decimal from "decimal.js";

import type { Money } from "@/interfaces";
import { toDecimal } from "@/utils/money";

/**
 * Every window this group sends to the API is a half-open UTC interval
 * `[from, to)` — that is what `GET /withheld` and `GET /receipts/summary` both
 * document ("exclusive upper bound"), and mixing an inclusive one in would
 * double-count a call that lands on midnight.
 *
 * UTC and not local time, because the figures are stated in UTC everywhere on
 * these screens ("resets 00:00 UTC", "2026-08-10 11:48 UTC"). Deriving a month
 * from the browser's offset would put a call in the wrong month for anyone west
 * of Greenwich, and the guarantee is a monthly number.
 */

export interface Period {
  /** Inclusive lower bound, ISO-8601. */
  from: string;
  /** Exclusive upper bound, ISO-8601. */
  to: string;
  /** "August 2026" — the design's own month wording. */
  label: string;
  /** Stable react key, `2026-08`. */
  key: string;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function monthPeriod(anchor: Date): Period {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: MONTH_LABEL.format(from),
    key: `${y}-${String(m + 1).padStart(2, "0")}`,
  };
}

/** Newest first — the order the Guarantee screen's "By month" table lists them in. */
export function recentMonths(anchor: Date, count: number): Period[] {
  return Array.from({ length: count }, (_, i) =>
    monthPeriod(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1))),
  );
}

export function dayPeriod(anchor: Date): Period {
  const from = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()),
  );
  const to = new Date(from.getTime() + 86_400_000);
  const key = from.toISOString().slice(0, 10);
  return { from: from.toISOString(), to: to.toISOString(), label: key, key };
}

/** The last `count` days ending today, oldest first — chart order. */
export function recentDays(anchor: Date, count: number): Period[] {
  return Array.from({ length: count }, (_, i) =>
    dayPeriod(new Date(anchor.getTime() - (count - 1 - i) * 86_400_000)),
  );
}

/** `2026-08-19` -> `Aug 19`, for a chart axis. */
const AXIS_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function axisLabel(isoDate: string): string {
  return AXIS_LABEL.format(new Date(`${isoDate}T00:00:00.000Z`));
}

/**
 * A share of a total, as the design writes it: one decimal place with a `%`.
 * Returns null when the denominator is zero — the design has no "0.0%" and a
 * percentage of nothing is not zero, it is undefined.
 */
export function sharePercent(part: Money | null, whole: Money | null): string | null {
  if (!part || !whole) return null;
  const denominator = toDecimal(whole);
  if (denominator.isZero()) return null;
  return `${toDecimal(part).div(denominator).mul(100).toFixed(1)}%`;
}

/** Signed period-over-period change, e.g. "▲ 38% vs yesterday". */
export function trendLabel(current: Money | null, previous: Money | null, suffix: string): string | null {
  if (!current || !previous) return null;
  const before = toDecimal(previous);
  if (before.isZero()) return null;
  const delta = toDecimal(current).minus(before).div(before).mul(100);
  if (delta.isZero()) return `no change ${suffix}`;
  const arrow = delta.isPositive() ? "▲" : "▼";
  return `${arrow} ${delta.abs().toFixed(0)}% ${suffix}`;
}

/** True when the trend is an increase — the design colours only that one. */
export function trendIsUp(current: Money | null, previous: Money | null): boolean {
  if (!current || !previous) return false;
  return toDecimal(current).greaterThan(toDecimal(previous));
}

export function sumMoney(items: Money[], fallback: Money | null): Money | null {
  if (items.length === 0) return fallback;
  const total = items.reduce((acc, m) => acc.plus(toDecimal(m)), new Decimal(0));
  const { asset, decimals } = items[0];
  return {
    amount: total.mul(new Decimal(10).pow(decimals)).toFixed(0),
    asset,
    decimals,
  };
}

export function isZeroMoney(money: Money | null | undefined): boolean {
  return !money || toDecimal(money).isZero();
}

/** Counts formatted the way every figure on these screens is: grouped. */
const COUNT = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** `2026-08-10 11:48 UTC` — the stamp the Overview header carries. */
export function formatUtcStamp(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** `14:13` — the time a recent call was made, in UTC like every other stamp. */
export function formatUtcTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}

/** An age in the design's own shorthand: `12s`, `4m`, `2h`, `3d`. */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** `dcff5fef-5f11-…` — an id shown because no endpoint exposes a name. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
