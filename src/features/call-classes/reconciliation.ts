import Decimal from "decimal.js";

import type { Money, ProviderReconciliation } from "@/interfaces";

import { CLASS_ORDER, type ClassTable, type ObservedTake } from "./csv";

/**
 * The reconciliation screen's figures, from one of two sources.
 *
 * - `ledger` — `GET /providers/me/reconciliation`, aggregated over every call
 *   in the window. This is the normal source: its counts and shares are the
 *   whole month's.
 * - `export` — the per-call CSV folded in the browser, used only when the
 *   endpoint cannot be read. The CSV is capped (50,000 rows), so a screen on
 *   this source must say its shares cover only the file.
 *
 * The money is the same on both: `gross` is Σ price over the credited calls,
 * `take` Σ platform_fee over the same calls and `net` Σ provider_amount, so
 * `gross − take = net`, and `net` is the total of the class `credited` column.
 */
export interface ReconClassRow {
  className: string;
  calls: number;
  /** 0..1 of every call the source counts. */
  share: number;
  /** Net of the platform's take: what reached the provider. */
  credited: Money | null;
}

export interface ReconSummary {
  source: "ledger" | "export";
  rows: ReconClassRow[];
  totalCalls: number;
  gross: Money | null;
  take: Money | null;
  net: Money | null;
  /** The take rate the provider terms state; `null` when the source carries none. */
  configuredRatePercent: number | null;
  /** The rate the figures realise, formatted (`20%`, `mixed 10–20%`); `null` when no fee was taken. */
  observedRate: string | null;
  /** The realised rate as a number when it is a single one, for comparing with the terms. */
  observedRatePercent: number | null;
}

/**
 * The classes shown even with no calls: the ways a call that passed can still
 * pay the provider nothing (yet). Hidden at zero, a provider would not learn
 * they exist until one happens. The other zero classes stay hidden — TEST and
 * EXCLUDED have no producer, and a row for them would read as traffic.
 */
export const ALWAYS_SHOWN_CLASSES: ReadonlySet<string> = new Set([
  "PAID_CREDITED",
  "PAID_BUYER_DEBT",
  "PAID_UNCOLLECTED",
  "PROVIDER_FORFEITED",
]);

function ordered(rows: ReconClassRow[]): ReconClassRow[] {
  const byClass = new Map(rows.map((row) => [row.className, row]));
  const known = new Set<string>(CLASS_ORDER);
  const out: ReconClassRow[] = [];
  for (const className of CLASS_ORDER) {
    const row = byClass.get(className);
    if (row && row.calls > 0) out.push(row);
    else if (ALWAYS_SHOWN_CLASSES.has(className)) {
      out.push(row ?? { className, calls: 0, share: 0, credited: null });
    }
  }
  // A class this build does not know still counts: the totals must add up.
  for (const row of rows) if (!known.has(row.className) && row.calls > 0) out.push(row);
  return out;
}

/** `take / gross` in percent, or null when nothing was taken or billed. */
export function realisedRatePercent(gross: Money | null, take: Money | null): Decimal | null {
  if (!gross || !take) return null;
  const g = new Decimal(gross.amount || "0");
  const t = new Decimal(take.amount || "0");
  if (g.isZero() || t.isZero()) return null;
  return t.div(g).mul(100);
}

const showRate = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();

export function fromLedger(data: ProviderReconciliation): ReconSummary {
  const rate = realisedRatePercent(data.gross, data.platformTake);
  return {
    source: "ledger",
    rows: ordered(
      data.classBreakdown.map((row) => ({
        className: row.class,
        calls: row.calls,
        share: row.share,
        credited: row.credited,
      }))
    ),
    totalCalls: data.callCount,
    gross: data.gross,
    take: data.platformTake,
    net: data.net,
    configuredRatePercent: Number.isFinite(data.platformTakeRatePercent)
      ? data.platformTakeRatePercent
      : null,
    observedRate: rate ? `${showRate(rate)}%` : null,
    observedRatePercent: rate ? rate.toNumber() : null,
  };
}

export function fromExport(table: ClassTable, observed: ObservedTake): ReconSummary {
  return {
    source: "export",
    rows: ordered(
      table.buckets.map((bucket) => ({
        className: bucket.className,
        calls: bucket.calls,
        share: bucket.share,
        credited: bucket.credited,
      }))
    ),
    totalCalls: table.totalCalls,
    gross: table.totalGross,
    take: table.totalFee,
    net: table.totalCredited,
    configuredRatePercent: null,
    observedRate: observed.words,
    observedRatePercent: observed.rates.length === 1 ? Number(observed.rates[0]) : null,
  };
}

/**
 * The Settlement block's "Platform take" label and note.
 *
 * "verified" is said only when the fees actually taken come to the rate the
 * terms state (the API's own definition). When they do not, both rates are
 * printed and the row says they differ, rather than putting "verified" next
 * to a rate nobody was charged.
 */
export function takeCopy(summary: ReconSummary): { label: string; note: string } {
  const { configuredRatePercent: terms, observedRate, observedRatePercent } = summary;
  if (!observedRate) {
    return {
      label: terms != null ? `Platform take (${terms}% in your terms)` : "Platform take",
      note: "no fee was taken on these calls",
    };
  }
  if (terms == null) {
    return {
      label: `Platform take (observed ${observedRate})`,
      note: "fees taken ÷ gross, on the calls in this file",
    };
  }
  if (observedRatePercent != null && Math.abs(observedRatePercent - terms) < 0.05) {
    return {
      label: `Platform take (${terms}%, verified)`,
      note: `the fees taken come to ${terms}% of gross, the rate in your terms`,
    };
  }
  return {
    label: `Platform take (observed ${observedRate}, terms ${terms}%)`,
    note: `the fees taken come to ${observedRate} of gross, not the ${terms}% in your terms · not verified`,
  };
}
