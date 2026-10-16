import type { Money, ProviderCallsExport } from "@/interfaces";

/**
 * The per-call CSV export, read as rows.
 *
 * ## Why a CSV parser lives in the client
 *
 * `GET /providers/me/calls/export` is the **only** endpoint on the provider
 * side that carries a call. `/traffic` and `/quality` are provider-wide daily
 * aggregates with no tool or binding dimension; `/verdicts` answers a provider
 * persona with an empty page (payer-org scoping); `/earnings?groupBy=tool` is
 * money only, no verdict and no timestamp. So the provider calls screen's per-binding tiles and
 * The verdict table's verdict table have exactly one honest source, and it is a file.
 *
 * The column order is fixed by the server and documented on
 * `ProviderCallsExport`. This module does not trust that: it reads the header
 * line and indexes by name, so a column inserted upstream shifts nothing.
 *
 * Nothing here converts an amount to a number. `provider_amount`,
 * `platform_fee` and `price_amount` are minor-unit digit strings and are
 * handed on as `Money` with the row's own `asset`/`decimals`, so every render
 * still goes through `formatMoney`.
 */

/** One row of the export. Every field is exactly what the server wrote. */
export interface ProviderCallRow {
  callId: string;
  intentId: string;
  /** ISO-8601, UTC. */
  createdAt: string;
  toolId: string;
  /** A `PaymentIntentStatus`. */
  status: string;
  /** A call class — `PAID_CREDITED`, `FREE`, `EXPLORATION`, `PENDING`, … */
  classification: string;
  /** Free text the settlement path wrote. Empty on a call nothing explained. */
  reason: string;
  /** A `VerdictStatus`, or `null` where no verdict was reached. */
  verdict: string | null;
  /** What the provider earns on this call, before the outcome is applied. */
  providerAmount: Money;
  platformFee: Money;
  /** What the agent was quoted. */
  priceAmount: Money;
}

/**
 * RFC 4180, the subset a CSV writer emits: CRLF or LF rows, `"` quoting,
 * `""` for an embedded quote. Written out rather than pulled in as a
 * dependency — `reason` is free text and *will* eventually contain a comma,
 * so a `split(",")` here would be a latent defect, not a shortcut.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // Swallowed; the \n that follows ends the row.
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function money(amount: string, asset: string, decimals: string): Money {
  const scale = Number(decimals);
  return {
    amount: /^\d+$/.test(amount) ? amount : "0",
    asset,
    decimals: Number.isFinite(scale) ? scale : 0,
  };
}

/** Header-indexed, so a new server column cannot silently shift a field. */
export function parseCallRows(csv: string): ProviderCallRow[] {
  const table = parseCsv(csv);
  if (table.length === 0) return [];

  const header = table[0].map((name) => name.trim());
  const at = (name: string) => header.indexOf(name);
  const i = {
    callId: at("call_id"),
    intentId: at("intent_id"),
    createdAt: at("created_at"),
    toolId: at("tool_id"),
    status: at("status"),
    classification: at("classification"),
    reason: at("reason"),
    verdict: at("verification_verdict"),
    providerAmount: at("provider_amount"),
    platformFee: at("platform_fee"),
    priceAmount: at("price_amount"),
    asset: at("asset"),
    decimals: at("decimals"),
  };
  if (i.callId < 0 || i.createdAt < 0) return [];

  const get = (cells: string[], index: number) => (index < 0 ? "" : (cells[index] ?? ""));

  return table.slice(1).flatMap((cells) => {
    if (cells.length === 1 && cells[0].trim() === "") return [];
    const asset = get(cells, i.asset);
    const decimals = get(cells, i.decimals);
    const verdict = get(cells, i.verdict).trim();
    return [
      {
        callId: get(cells, i.callId),
        intentId: get(cells, i.intentId),
        createdAt: get(cells, i.createdAt),
        toolId: get(cells, i.toolId),
        status: get(cells, i.status),
        classification: get(cells, i.classification),
        reason: get(cells, i.reason),
        verdict: verdict === "" ? null : verdict,
        providerAmount: money(get(cells, i.providerAmount), asset, decimals),
        platformFee: money(get(cells, i.platformFee), asset, decimals),
        priceAmount: money(get(cells, i.priceAmount), asset, decimals),
      },
    ];
  });
}

export function rowsOf(exported: ProviderCallsExport | undefined): ProviderCallRow[] {
  return exported ? parseCallRows(exported.csv) : [];
}

/**
 * Whether the provider actually keeps this call's money.
 *
 * The export's `provider_amount` is the intent's column, which is populated on
 * a REFUNDED or VOIDED intent too — it is what the provider *would* have
 * earned. Rendering it as "paid to you" on a failed call would overstate
 * earnings by the whole withheld amount, so the counterfactual is kept as two
 * figures (see `docs` rule 01: listed and charged, always both).
 */
export function isCredited(row: ProviderCallRow): boolean {
  // Settled, but the export says the credit is not written (yet), or the
  // provider forfeited the voucher and nothing was collected or credited.
  return (
    row.status === "SETTLED" &&
    row.classification !== "PENDING" &&
    row.classification !== "PAID_AWAITING_REDEMPTION" &&
    row.classification !== "PROVIDER_FORFEITED" &&
    // Buyer debt (not paid yet) and uncollected (never paid): nothing reached
    // the provider, and the platform never pays in the buyer's place.
    row.classification !== "PAID_BUYER_DEBT" &&
    row.classification !== "PAID_UNCOLLECTED" &&
    // A buyer debt voided by a late failing verdict stays SETTLED, but is
    // PAID_UNCREDITED with zero amounts: nobody was credited.
    row.classification !== "PAID_UNCREDITED"
  );
}

/** UTC-day-precise start of the day `ms` falls in. */
export function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `YYYY-MM-DD` for a millisecond instant, in UTC. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
