import type { Money } from "@/interfaces";

/**
 * Response shapes read off the running API, not off the OpenAPI document.
 *
 * Two of these are wider than the typed service that fetches them:
 *
 *  - `GET /withheld` is declared in `balances.service.ts` as
 *    `{ total?, buckets?, reconciliation? }` with an index signature. What it
 *    actually returns is `{ withheld: [ … ] }` — one entry PER ASSET, each
 *    holding its own decomposition plus a ledger reconciliation block. The
 *    index signature is what makes reading it here type-safe without editing
 *    a shared service.
 *  - `GET /receipts/summary` is declared as `Promise<unknown>`.
 *
 * Both are reported to the parent rather than patched in place.
 */

/** One terminal-state bucket of the withheld figure. */
export interface WithheldBucket {
  /**
   * `FAILED_VERIFICATION` | `PROVIDER_OR_PLATFORM_ERROR` | `NOT_COLLECTED` |
   * anything later. Always every bucket, zero-filled; the total equals
   * `GET /receipts/summary`'s `notChargedTotal` for the same window. Rendered
   * through `not-charged.ts`, never mapped per screen.
   */
  bucket: string;
  /** The API's own wording, e.g. "failed verification". Not the design's. */
  label: string;
  calls: number;
  amount: Money;
}

export interface WithheldForAsset {
  withheld: {
    asset: string;
    calls: number;
    amount: Money;
    buckets: WithheldBucket[];
  };
  /**
   * The ledger side of the identity the Guarantee screen page header states:
   * `withheld == Σ HOLD_RELEASE`. `ok` is the API's own verdict on it.
   */
  holdReleaseTotal: Money;
  orphanedReleases: Money;
  orphanedHoldIds: string[];
  ok: boolean;
  difference: string;
}

export interface WithheldWire {
  withheld: WithheldForAsset[];
}

export interface SummaryTotals {
  calls: number;
  refundedCalls: number;
  listedTotal: Money;
  /** Served and collected. Open or written-off buyer debt is in `owedTotal`. */
  chargedTotal: Money;
  /**
   * Refunded, voided and expired calls only: a part of `notChargedTotal`, not
   * all of it. Screens read `notChargedTotal` and `GET /withheld`'s lines.
   */
  withheldTotal: Money;
  /** `listedTotal = chargedTotal + notChargedTotal + owedTotal + inProgressTotal`. */
  notChargedTotal: Money;
  notChargedCalls: number;
  /** Buyer debt, open or written off: served, not collected yet, still owed. */
  owedTotal: Money;
  owedCalls: number;
  /** Calls not finished yet, at their listed price. */
  inProgressTotal: Money;
  inProgressCalls: number;
  /** Calls listed at zero (free tier), counted in `calls`. */
  freeCalls: number;
  failRate: number;
}

export interface SummaryGroup extends SummaryTotals {
  /** A date (`2026-08-19`), a tool id, a provider id, a status or a verdict. */
  key: string;
  comparison: unknown;
}

export interface SummaryWire {
  groups: SummaryGroup[];
  totals: SummaryTotals;
  asset: string;
}

export interface HoldRow {
  id: string;
  intentId: string;
  amount: Money;
  status: string;
  createdAt: string;
  ageSeconds: number;
  expiresAt: string;
}

/**
 * Narrows the loosely-typed `getWithheld()` result to the real shape.
 *
 * `GET /withheld` answers one entry per asset. `asset` is the one the screen's
 * summary came back in, so both halves of the page are the same money; with no
 * summary to match, the first entry stands.
 */
export function readWithheld(raw: unknown, asset?: string | null): WithheldForAsset | null {
  const list = (raw as WithheldWire | undefined)?.withheld;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((entry) => entry.withheld?.asset === asset) ?? list[0] ?? null;
}
