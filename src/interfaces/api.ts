/**
 * The wire contract, taken from the running API rather than from the docs.
 *
 * Two things the OpenAPI document gets wrong, both verified against real
 * responses on http://localhost:3000/api/v1:
 *
 *  - The spec says a list endpoint returns `{ items, pageInfo }`. It does not.
 *    `TransformInterceptor` (registered in the backend's
 *    src/bootstrap/api/main.ts) wraps every SUCCESS in
 *    `{ data, statusCode, message }`. Errors are NOT wrapped — they come from
 *    the exception filter in a different shape entirely.
 *  - `ToolCallDto.verdict` is declared as a 7-value enum that does not include
 *    `UNVERIFIED`, yet `UNVERIFIED` is what the seeded data returns, and a call
 *    that expired returns `null`. See `@/utils/verdict`.
 */

/** Every successful response is wrapped in this. Errors are not. */
export interface ApiEnvelope<T> {
  data: T;
  statusCode: number;
  message: string;
}

/** The error body, straight from the exception filter. */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    path: string;
    timestamp: string;
  };
}

/**
 * Cursor pagination. There is exactly one paging style across the whole API and
 * this is it — do not add a page/limit variant, and do not parse the cursor.
 * The backend's own DTO says so: "Do not construct or parse these — the
 * encoding is not part of the contract."
 */
export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CursorPage<T> {
  items: T[];
  pageInfo: PageInfo;
}

/** The query shape every list endpoint accepts. Resources add their own filters. */
export interface ListQuery {
  cursor?: string;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
  /**
   * Accepted on several list endpoints. Note that /verdicts accepts it and
   * then IGNORES it — an id that matches nothing still returns every row — so
   * do not rely on it there without checking the result.
   */
  search?: string;
}

/**
 * Money is minor units as a STRING, plus the scale to divide by. It is never a
 * number on the wire, and it must never become one in transit — 4990000 with
 * decimals 6 is $4.99, and the moment it goes through a float it stops being
 * exactly that. Render it with `formatMoney` from `@/utils/money`.
 */
export interface Money {
  amount: string;
  asset: string;
  decimals: number;
}

/**
 * What `ToolCallDto.verdict` can actually be. Wider than the OpenAPI enum,
 * because the enum is wrong: `UNVERIFIED` is absent from it and present on the
 * wire, and the field is nullable in practice.
 */
export type WireVerdict =
  | "PASS"
  | "FAIL"
  | "DEGRADED"
  | "SKIPPED"
  | "EMPTY_CONFIRMED"
  | "EMPTY_UNVERIFIED"
  | "UNVERIFIED"
  | "MISAPPLIED"
  | null;
