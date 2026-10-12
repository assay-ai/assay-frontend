import Decimal from "decimal.js";

import type { Money } from "@/interfaces";

/**
 * The per-call CSV, parsed and folded into the two tables the call-classes screen and the provider earnings screen are
 * built around.
 *
 * `GET /providers/me/calls/export` is the only provider endpoint that emits a
 * row per call, and `X-X402-Call-Id` is its first column — which is the whole
 * reason both screens exist. A provider counts N requests in their access log,
 * we count M, and the join key that explains the difference is in this file.
 *
 * Everything here is pure. The fetch, the cap headers and the download live in
 * `use-calls-export.ts`.
 *
 * ## Column order is the server's, not ours
 *
 * `call_id, intent_id, created_at, tool_id, status, classification, reason,
 * verification_verdict, provider_amount, platform_fee, price_amount, asset,
 * decimals` — fixed by the export service and documented on
 * `ProviderCallsExport`. The header line is parsed rather than assumed, so a
 * reordering upstream is a missing column here and not a silently shifted one.
 */

export interface CallRow {
  callId: string;
  intentId: string;
  /** ISO-8601 instant the call was created. */
  createdAt: string;
  toolId: string;
  /** `PaymentIntentStatus` — SETTLED, REFUNDED, VOIDED, EXPIRED, VERIFYING… */
  status: string;
  /** The call class. */
  classification: string;
  reason: string;
  /** PASS / FAIL / empty when the call was never judged. */
  verdict: string;
  /** Minor units, as strings. Never parsed into a JS number. */
  providerAmount: string;
  platformFee: string;
  priceAmount: string;
  asset: string;
  decimals: number;
}

/**
 * A single CSV record, RFC-4180 quoting included.
 *
 * `reason` is free text written by the worker and can hold a comma at any
 * time; splitting on `,` would then shift every column after it and silently
 * mis-attribute money. It costs a dozen lines to do properly.
 */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

export function parseCallsCsv(csv: string): CallRow[] {
  const lines = csv.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = parseLine(lines[0]);
  const at = (cells: string[], name: string): string => {
    const index = header.indexOf(name);
    return index === -1 ? "" : (cells[index] ?? "");
  };

  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return {
      callId: at(cells, "call_id"),
      intentId: at(cells, "intent_id"),
      createdAt: at(cells, "created_at"),
      toolId: at(cells, "tool_id"),
      status: at(cells, "status"),
      classification: at(cells, "classification"),
      reason: at(cells, "reason"),
      verdict: at(cells, "verification_verdict"),
      providerAmount: at(cells, "provider_amount") || "0",
      platformFee: at(cells, "platform_fee") || "0",
      priceAmount: at(cells, "price_amount") || "0",
      asset: at(cells, "asset"),
      decimals: Number(at(cells, "decimals") || "6"),
    };
  });
}

/**
 * Money actually reached the provider only on a SETTLED intent.
 *
 * The CSV carries `provider_amount` on **every** row, including the refunded,
 * voided and expired ones — it is the amount the call was worth, not the
 * amount that moved. Summing it blindly would tell a provider they were paid
 * for calls that were refunded to the buyer, which is the exact lie both these
 * screens exist to prevent. Verified against `GET /providers/me/earnings`:
 * Σ provider_amount over SETTLED equals `totals.earned` to the minor unit, and
 * Σ over the rest equals `totals.withheld`.
 */
function isCredited(row: CallRow): boolean {
  // A rail-B call the verdict settled is credited only once its voucher is
  // redeemed on chain; until then the export says PAID_AWAITING_REDEMPTION.
  return row.status === "SETTLED" && row.classification !== "PAID_AWAITING_REDEMPTION";
}

/** A call still in flight has neither earned nor withheld anything yet. */
function isPending(row: CallRow): boolean {
  return (
    row.status === "VERIFYING" ||
    row.classification === "PENDING" ||
    row.classification === "PAID_AWAITING_REDEMPTION"
  );
}

/**
 * Σ over `rows`, denominated in the asset `denom` names.
 *
 * The distinction between a null and a zero is the whole reason `denom` exists.
 * A class that served 14 calls and was credited for none of them was paid
 * **$0.00** — a real zero, and the design writes it as one. A window that matched
 * nothing at all has no asset to denominate anything in, and answers null, which
 * the screens render as an em dash. So the sum is scoped by the rows being added
 * and the currency by the group they came from.
 */
function sum(
  rows: CallRow[],
  pick: (row: CallRow) => string,
  denom: CallRow[] = rows
): Money | null {
  if (denom.length === 0) return null;
  const total = rows.reduce((acc, row) => acc.plus(new Decimal(pick(row) || "0")), new Decimal(0));
  return { amount: total.toFixed(0), asset: denom[0].asset, decimals: denom[0].decimals };
}

// ── Call classes ───────────────────────────────────────────────────────────

/**
 * The order both designs list the classes in.
 *
 * `ImhZR` draws PAID_CREDITED · PAID_UNCREDITED · FREE · TEST · SYSTEM_ERROR ·
 * REQUEST_ERROR; `g7KIN` draws the same sequence with EXPLORATION and EXCLUDED
 * inserted after FREE. This is the union, so one order serves both.
 *
 * A class is rendered only when the wire emits it. Today that is PAID_CREDITED,
 * PAID_UNCREDITED, FREE, EXPLORATION, SYSTEM_ERROR, REQUEST_ERROR and PENDING —
 * TEST and EXCLUDED have no producer yet, and CANARY was deliberately left out
 * altogether. Drawing an empty row for a class nothing can write would
 * be inventing traffic.
 *
 * PAID_AWAITING_REDEMPTION is ours too: a rail-B call that passed and is
 * credited once its voucher is redeemed on chain. Listed beside PAID_CREDITED.
 * So is PLATFORM_ABSORBED: credited from platform funds because the voucher
 * could never be redeemed (the `reason` column names why), with no fee taken.
 *
 * PENDING is the mirror image: the wire emits it and **neither design draws it**.
 * It is listed last because the totals have to add up — a screen whose job is
 * explaining a count difference cannot drop four calls to keep its layout.
 */
export const CLASS_ORDER = [
  "PAID_CREDITED",
  "PAID_AWAITING_REDEMPTION",
  "PLATFORM_ABSORBED",
  "PAID_UNCREDITED",
  "FREE",
  "EXPLORATION",
  "EXCLUDED",
  "TEST",
  "SYSTEM_ERROR",
  "REQUEST_ERROR",
  "PENDING",
] as const;

export interface ClassBucket {
  className: string;
  calls: number;
  /** 0..1 of all rows in the window. */
  share: number;
  /** Σ provider_amount over the SETTLED rows of this class. */
  credited: Money | null;
  /** Σ price_amount over the SETTLED rows — gross, before the platform's cut. */
  gross: Money | null;
  /** Σ platform_fee over the SETTLED rows. */
  fee: Money | null;
  /** Σ provider_amount over rows that failed and were never credited. */
  withheld: Money | null;
}

export interface ClassTable {
  buckets: ClassBucket[];
  /**
   * Rows whose `classification` is not in `CLASS_ORDER`, or is empty.
   *
   * This is the design's "Unexplained" row, and the design is emphatic that it
   * must read zero. It is a count of calls **we** hold that fall in no class —
   * not the count of rows in the provider's log we cannot match, which needs a
   * log we have no endpoint to receive.
   */
  unexplained: number;
  totalCalls: number;
  totalCredited: Money | null;
  totalGross: Money | null;
  totalFee: Money | null;
  totalWithheld: Money | null;
}

export function foldClasses(rows: CallRow[]): ClassTable {
  const known = new Set<string>(CLASS_ORDER);
  const buckets: ClassBucket[] = [];

  for (const className of CLASS_ORDER) {
    const inClass = rows.filter((r) => r.classification === className);
    if (inClass.length === 0) continue;
    const credited = inClass.filter(isCredited);
    const lost = inClass.filter((r) => !isCredited(r) && !isPending(r));
    buckets.push({
      className,
      calls: inClass.length,
      share: rows.length === 0 ? 0 : inClass.length / rows.length,
      credited: sum(credited, (r) => r.providerAmount, inClass),
      gross: sum(credited, (r) => r.priceAmount, inClass),
      fee: sum(credited, (r) => r.platformFee, inClass),
      withheld: sum(lost, (r) => r.providerAmount, inClass),
    });
  }

  const creditedRows = rows.filter(isCredited);
  const lostRows = rows.filter((r) => !isCredited(r) && !isPending(r));

  return {
    buckets,
    unexplained: rows.filter((r) => !known.has(r.classification)).length,
    totalCalls: rows.length,
    totalCredited: sum(creditedRows, (r) => r.providerAmount, rows),
    totalGross: sum(creditedRows, (r) => r.priceAmount, rows),
    totalFee: sum(creditedRows, (r) => r.platformFee, rows),
    totalWithheld: sum(lostRows, (r) => r.providerAmount, rows),
  };
}

// ── The realised take rate ─────────────────────────────────────────────────

export interface ObservedTake {
  /**
   * The distinct realised rates in the window, formatted, ascending.
   * Empty when nothing in the window realised a fee.
   */
  rates: string[];
  /**
   * The parenthetical both screens print, e.g. `observed 20%`. `null` when no
   * row in the window carries an observable rate — the screens then drop the
   * parenthesis rather than printing a rate they did not see.
   */
  summary: string | null;
  /** The rate on its own, for use inside a sentence. `null` as above. */
  words: string | null;
}

/**
 * The platform's take, **measured** on the calls in the window.
 *
 * ## Why this is derived and not a constant
 *
 * Both designs print a fixed percentage in the "Take" header and the
 * Settlement row. The rate is not a constant: it is configurable per
 * deployment (`PLATFORM_FEE_BPS` on the backend), so a fixed label could
 * disagree with the column of figures beneath it. On a reconciliation screen
 * the label must come from the data.
 *
 * Every row carries `price_amount` and `platform_fee`, so the realised rate is
 * exact and needs no endpoint. Only settled rows count — a refunded call had a
 * would-be fee and nothing was taken — and only priced ones, because a FREE
 * call's 0/0 is not a rate.
 *
 * ## Mixed windows are not averaged
 *
 * Rates are deduplicated on the **exact** ratio, before formatting. A window
 * holding two tiers reports both bounds and the word "mixed"; it never collapses
 * into a single mean that matches no row a provider could look up. Deduping on
 * the exact value rather than the printed one means the conservative direction:
 * two rates that print the same still report as mixed.
 */
export function observedTakeRate(rows: CallRow[]): ObservedTake {
  const exact = new Map<string, Decimal>();
  for (const row of rows) {
    // An absorbed call is credited but took no fee: it carries no rate.
    if (!isCredited(row) || row.classification === "PLATFORM_ABSORBED") continue;
    const price = new Decimal(row.priceAmount || "0");
    if (price.isZero()) continue;
    const rate = new Decimal(row.platformFee || "0").div(price).mul(100);
    exact.set(rate.toString(), rate);
  }

  if (exact.size === 0) return { rates: [], summary: null, words: null };

  const sorted = [...exact.values()].sort((a, b) => a.comparedTo(b));
  const show = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
  const rates = sorted.map(show);

  if (exact.size === 1) {
    return { rates, summary: `observed ${rates[0]}%`, words: `${rates[0]}%` };
  }

  const span = `${rates[0]}\u2013${rates[rates.length - 1]}%`;
  return { rates, summary: `observed, mixed ${span}`, words: `mixed ${span}` };
}

// ── Why a call was not credited ────────────────────────────────────────────

export interface NotCreditedBucket {
  /** The call class the failure fell into. */
  className: string;
  calls: number;
  /** What the provider would have been credited had the call passed. */
  notCredited: Money | null;
}

/**
 * The "Reason a call failed" table.
 *
 * **The design's rows are verification rule ids** — `MIN_ARRAY_LENGTH`,
 * `FRESHNESS`, `semantic relevance`. No provider-readable endpoint exposes a
 * rule breakdown: `GET /verdicts` is scoped to the *payer* organization and
 * answers a provider with an empty page (measured, not assumed), and
 * `/providers/me/quality` groups by verdict status only, which carries no
 * money. The CSV's own `reason` column is free text written by the worker, so
 * it is the wrong granularity and, on seeded data, is literally prefixed
 * "demo seed:".
 *
 * So the coarsest honest answer stands in: the call class. Only calls that
 * were **not** credited and are **not** still in flight are counted — a passed
 * call has no failure reason and a pending one does not have one yet. The
 * totals equal `GET /providers/me/earnings` → `totals.withheld` and
 * `withheldCalls`, which is the cross-check that the grouping is complete.
 */
export function foldNotCredited(rows: CallRow[]): {
  buckets: NotCreditedBucket[];
  calls: number;
  notCredited: Money | null;
} {
  const failed = rows.filter((r) => !isCredited(r) && !isPending(r));
  const byClass = new Map<string, CallRow[]>();
  for (const row of failed) {
    const key = row.classification || "";
    const list = byClass.get(key);
    if (list) list.push(row);
    else byClass.set(key, [row]);
  }

  const buckets = [...byClass.entries()]
    .map(([className, group]) => ({
      className,
      calls: group.length,
      notCredited: sum(group, (r) => r.providerAmount),
    }))
    .sort((a, b) => b.calls - a.calls);

  return { buckets, calls: failed.length, notCredited: sum(failed, (r) => r.providerAmount) };
}

// ── Traffic, by day and tool ───────────────────────────────────────────────

export interface DayToolCount {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** Calls per `toolId`. */
  byTool: Record<string, number>;
}

/**
 * Call volume per UTC day per tool, for the last `days` days ending on
 * `anchor` — zero-filled, so a quiet day is a gap in the bars and not a
 * missing column.
 */
export function foldTraffic(rows: CallRow[], anchor: Date, days: number): DayToolCount[] {
  const end = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const out: DayToolCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push({ day: new Date(end - i * 86_400_000).toISOString().slice(0, 10), byTool: {} });
  }
  const index = new Map(out.map((d) => [d.day, d]));

  for (const row of rows) {
    const day = row.createdAt.slice(0, 10);
    const bucket = index.get(day);
    if (!bucket) continue;
    bucket.byTool[row.toolId] = (bucket.byTool[row.toolId] ?? 0) + 1;
  }
  return out;
}

/** Calls made on one UTC day. */
export function callsOnDay(rows: CallRow[], day: string): number {
  return rows.filter((r) => r.createdAt.slice(0, 10) === day).length;
}
