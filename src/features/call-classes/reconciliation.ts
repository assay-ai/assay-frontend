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
  /** The source's own note for the class (the ledger sends one), the fallback for a class this build does not explain. */
  note?: string;
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
  /**
   * The always-explained classes ({@link ALWAYS_SHOWN_CLASSES}) that had no
   * calls: named once in a quiet line rather than as rows of zeros.
   */
  emptyClasses: string[];
}

/**
 * The classes named even with no calls: the ways a call that passed can still
 * pay the provider nothing (yet). Hidden at zero, a provider would not learn
 * they exist until one happens, so they are listed once as "none this month"
 * instead of as rows of zeros. The other zero classes stay hidden — TEST and
 * EXCLUDED have no producer, and naming them would read as traffic.
 */
export const ALWAYS_SHOWN_CLASSES: ReadonlySet<string> = new Set([
  "PAID_CREDITED",
  "PAID_BUYER_DEBT",
  "PAID_UNCOLLECTED",
  "PROVIDER_FORFEITED",
]);

function ordered(rows: ReconClassRow[]): { rows: ReconClassRow[]; emptyClasses: string[] } {
  const byClass = new Map(rows.map((row) => [row.className, row]));
  const known = new Set<string>(CLASS_ORDER);
  const out: ReconClassRow[] = [];
  const emptyClasses: string[] = [];
  for (const className of CLASS_ORDER) {
    const row = byClass.get(className);
    if (row && row.calls > 0) out.push(row);
    else if (ALWAYS_SHOWN_CLASSES.has(className)) emptyClasses.push(className);
  }
  // A class this build does not know still counts: the totals must add up.
  for (const row of rows) if (!known.has(row.className) && row.calls > 0) out.push(row);
  return { rows: out, emptyClasses };
}

/**
 * One line per class: what it means for the provider, in plain words. The
 * ledger's own note stands in for a class this build does not know.
 */
const CLASS_NOTE: Record<string, string> = {
  PAID_CREDITED: "Passed our checks and paid to your wallet.",
  PAID_AWAITING_REDEMPTION: "Passed our checks; reaches your wallet once the payment is collected on chain.",
  PAID_BUYER_DEBT: "Passed, but the buyer's payment did not go through yet. Paid to you when they settle.",
  PAID_UNCOLLECTED: "Passed; the buyer did not settle in 30 days. Written off, but still owed: you are paid if they settle.",
  PROVIDER_FORFEITED: "Not collected because your stake was below the minimum, or you were blocked.",
  PAID_UNCREDITED: "Your answer failed our checks, so the buyer was not charged.",
  FREE: "Free-tier calls: nothing charged, nothing paid.",
  EXPLORATION: "Trial calls to a new listing. The buyer pays as usual; Assay pays only for the checks.",
  EXCLUDED: "Taken out of the count by our team, for example during an incident on our side.",
  TEST: "Your own test runs.",
  SYSTEM_ERROR: "Your endpoint timed out or returned a 5xx error.",
  REQUEST_ERROR: "Your endpoint refused the request with a 4xx error.",
  PENDING: "Still being checked; usually settled within a minute.",
};

export function classNote(className: string, fallback?: string): string {
  return CLASS_NOTE[className] ?? fallback ?? "";
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
    ...ordered(
      data.classBreakdown.map((row) => ({
        className: row.class,
        calls: row.calls,
        share: row.share,
        credited: row.credited,
        note: row.note,
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
    ...ordered(
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
 * The Settlement block's fee row, in plain words: "Assay fee 10%" and whether
 * it matches the provider's terms.
 *
 * "Matches your terms" is said only when the fees actually taken come to the
 * rate the terms state (the API's own definition of verified). When they do
 * not, both rates are printed and the row is a warning, rather than putting a
 * reassurance next to a rate nobody was charged.
 */
export interface TakeCopy {
  label: string;
  note: string;
  tone: "neutral" | "success" | "warning";
}

export function takeCopy(summary: ReconSummary): TakeCopy {
  const { configuredRatePercent: terms, observedRate, observedRatePercent } = summary;
  if (!observedRate) {
    return {
      label: "Assay fee",
      note: terms != null ? `No fee was taken on these calls (your terms: ${terms}%).` : "No fee was taken on these calls.",
      tone: "neutral",
    };
  }
  if (terms == null) {
    return {
      label: `Assay fee ${observedRate}`,
      note: "Fees taken ÷ gross, on the calls in the per-call file.",
      tone: "neutral",
    };
  }
  if (observedRatePercent != null && Math.abs(observedRatePercent - terms) < 0.05) {
    return { label: `Assay fee ${terms}%`, note: "Matches your terms.", tone: "success" };
  }
  return {
    label: `Assay fee ${observedRate}`,
    note: `Does not match the ${terms}% in your terms. Contact support with this month's CSV.`,
    tone: "warning",
  };
}
