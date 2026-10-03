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
  /** `FAILED_VERIFICATION` | `PROVIDER_OR_PLATFORM_ERROR` | anything later. */
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
  chargedTotal: Money;
  withheldTotal: Money;
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

/** Narrows the loosely-typed `getWithheld()` result to the real shape. */
export function readWithheld(raw: unknown): WithheldForAsset | null {
  const list = (raw as WithheldWire | undefined)?.withheld;
  if (!Array.isArray(list) || list.length === 0) return null;
  // The MVP settles in one asset; a second one would need an asset selector
  // rather than a silent pick, so this deliberately reads the first only.
  return list[0] ?? null;
}
