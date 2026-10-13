import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";

/**
 * The list's three filters and its one order. Pure, so the page and the tests
 * run the same code.
 */

export type StatusFilter = "attention" | "pending" | "disputed" | "executed" | "cancelled" | "all";

export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "attention", label: "Needs attention" },
  { value: "pending", label: "Pending" },
  { value: "disputed", label: "Disputed" },
  { value: "executed", label: "Executed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

export type TimeRange = "7d" | "30d" | "90d" | "all";

export const TIME_RANGES: readonly { value: TimeRange; label: string; seconds: number | null }[] = [
  { value: "7d", label: "Last 7 days", seconds: 7 * 86_400 },
  { value: "30d", label: "Last 30 days", seconds: 30 * 86_400 },
  { value: "90d", label: "Last 90 days", seconds: 90 * 86_400 },
  { value: "all", label: "All time", seconds: null },
];

export interface SlashFilters {
  readonly status: StatusFilter;
  readonly range: TimeRange;
  /** Free text, matched against the request id and the beneficiary. */
  readonly query: string;
}

export const DEFAULT_FILTERS: SlashFilters = { status: "attention", range: "all", query: "" };

function matchesStatus(row: ChainSlashRow, status: StatusFilter): boolean {
  switch (status) {
    case "attention":
      /* Pending, Disputed, and any status this page cannot name (see `libs/chains/evm/stake-slashes/status.ts`). */
      return row.status.needsAttention;
    case "all":
      return true;
    default:
      return row.status.key === status;
  }
}

function matchesRange(row: ChainSlashRow, range: TimeRange, nowSeconds: number): boolean {
  const seconds = TIME_RANGES.find((entry) => entry.value === range)?.seconds ?? null;
  if (seconds === null) return true;
  return row.proposedAt >= nowSeconds - seconds;
}

/**
 * Case-insensitive substring on the request id and the beneficiary. A leading
 * `0x` is optional, so a pasted fragment from either end of a shortened id
 * (`3bec0b`, `…e5e3cb`) matches. The ellipsis character is ignored.
 */
function matchesQuery(row: ChainSlashRow, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/…/g, "").replace(/^0x/, "");
  if (needle === "") return true;
  return (
    row.requestId.toLowerCase().includes(needle) || row.beneficiary.toLowerCase().includes(needle)
  );
}

/**
 * Soonest executable first. Rows that still need attention come before closed
 * ones, so in "All" the open penalties are never pushed below history.
 */
export function compareRows(a: ChainSlashRow, b: ChainSlashRow): number {
  if (a.status.needsAttention !== b.status.needsAttention) return a.status.needsAttention ? -1 : 1;
  if (a.executableAt !== b.executableAt) return a.executableAt - b.executableAt;
  return a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0;
}

export function applyFilters(
  rows: readonly ChainSlashRow[],
  filters: SlashFilters,
  nowSeconds: number,
): ChainSlashRow[] {
  return rows
    .filter(
      (row) =>
        matchesStatus(row, filters.status) &&
        matchesRange(row, filters.range, nowSeconds) &&
        matchesQuery(row, filters.query),
    )
    .sort(compareRows);
}

/** How many rows need attention, before any filter: the header count. */
export function attentionCount(rows: readonly ChainSlashRow[]): number {
  return rows.filter((row) => row.status.needsAttention).length;
}
