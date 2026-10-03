import type {
  ProviderCallsExport,
  ProviderCallsExportMeta,
  ProviderCallsExportQuery,
  ProviderEarnings,
  ProviderEarningsQuery,
  ProviderQuality,
  ProviderQualityQuery,
  ProviderTraffic,
  ProviderTrafficQuery,
} from "@/interfaces";

import { api } from "./api";

/**
 * The report sub-resources of `providers/me`.
 *
 * The first three are **not** cursor lists and have no `cursor`/`limit`: a
 * bounded window of daily buckets is small enough to return whole, and a chart
 * wants every bucket in one response. `from` and `to` are required on all
 * four, ISO-8601, `from` inclusive and `to` exclusive.
 */

/**
 * `GET /providers/me/traffic` — call volume bucketed by UTC calendar day.
 *
 * Every status is zero-filled in every bucket, so a series never gains or
 * loses a line mid-chart. Both latency fields are always `null` today: there
 * is no per-day latency source, and the rolling snapshot on the profile is a
 * different quantity.
 *
 * The traffic report also takes an optional `agentId` filter and the response's
 * `agentBreakdown` — see `ProviderTrafficQuery`/`ProviderAgentTraffic`. Both
 * ride the same request; there is no second endpoint.
 */
export function getProviderTraffic(query: ProviderTrafficQuery): Promise<ProviderTraffic> {
  return api.get<ProviderTraffic>(
    "/providers/me/traffic",
    query as unknown as Record<string, unknown>
  );
}

/**
 * `GET /providers/me/quality`.
 *
 * `from`/`to` scope **only** `verdictMix` and `totalCalls`. The three rates
 * come off the registry snapshot and carry its own rolling window — 24h for
 * availability, 7d for quality. Labelling all five with one date range would
 * be wrong about three of them.
 */
export function getProviderQuality(query: ProviderQualityQuery): Promise<ProviderQuality> {
  return api.get<ProviderQuality>(
    "/providers/me/quality",
    query as unknown as Record<string, unknown>
  );
}

/**
 * `GET /providers/me/earnings` — earned vs platform fee vs withheld, grouped
 * by day or by tool.
 *
 * Pass `asset` when the window spans more than one, or this answers
 * `PROVIDER_MULTIPLE_ASSETS`. `null` money means the window matched nothing
 * and no asset narrowed it — there is then no asset to denominate a zero in.
 */
export function getProviderEarnings(query: ProviderEarningsQuery): Promise<ProviderEarnings> {
  return api.get<ProviderEarnings>(
    "/providers/me/earnings",
    query as unknown as Record<string, unknown>
  );
}

/**
 * `GET /providers/me/calls/export` — one CSV row per call served.
 *
 * ## Why this one does not go through `ApiClient.get`
 *
 * The body is `text/csv`, not the `{ data, statusCode, message }` envelope
 * every other route returns — the backend takes the response over directly
 * precisely because an envelope cannot wrap a file and stay a valid CSV. So
 * `ApiClient.get` would reach for `response.data.data` on a string and hand
 * back `undefined`. This uses the shared axios instance through `raw()`,
 * which keeps the bearer token, the parameter serialiser and the `ApiError`
 * rejection while skipping the unwrap.
 *
 * ## The three cap headers
 *
 * The export caps itself, and says so in `X-X402-Export-Row-Count`,
 * `X-X402-Export-Total-Matching` and `X-X402-Export-Truncated`, set before the
 * first byte. They are returned alongside the text rather than dropped,
 * because a caller holding only the body cannot tell a complete export from a
 * truncated one.
 *
 * `meta` is `null` when those headers were not readable. Treat that as "the
 * cap is unknown", never as "not truncated" — a synthetic `truncated: false`
 * tells a provider their export is complete on exactly the evidence that it
 * might not be.
 *
 * It used to be null in practice: the API app enabled CORS with no
 * `exposedHeaders`, so cross-origin the three cap headers and
 * `Content-Disposition` never reached JS. **That is fixed** — the response now
 * carries `Access-Control-Expose-Headers` for all four, measured from the
 * page. The null branch stays because a header can stop being exposed again,
 * but it is no longer the normal case.
 */
export async function exportProviderCalls(
  query: ProviderCallsExportQuery
): Promise<ProviderCallsExport> {
  const response = await api.raw().request<string>({
    method: "GET",
    url: "/providers/me/calls/export",
    params: query as unknown as Record<string, unknown>,
    responseType: "text",
    headers: { Accept: "text/csv" },
  });

  const headers = response.headers as unknown as Record<string, unknown>;

  return {
    csv: response.data,
    meta: readExportMeta(headers),
    filename: readFilename(headers),
  };
}

function headerValue(headers: Record<string, unknown>, name: string): string | null {
  const raw = headers[name];
  if (raw === undefined || raw === null) return null;
  return typeof raw === "string" ? raw : String(raw);
}

/**
 * All three headers or none. A partial read would put a real number next to an
 * invented one, and `truncated` is the field that decides whether a provider
 * believes their export is the whole answer.
 */
function readExportMeta(headers: Record<string, unknown>): ProviderCallsExportMeta | null {
  const rowCount = headerValue(headers, "x-x402-export-row-count");
  const totalMatching = headerValue(headers, "x-x402-export-total-matching");
  const truncated = headerValue(headers, "x-x402-export-truncated");
  if (rowCount === null || totalMatching === null || truncated === null) return null;

  return {
    rowCount: Number(rowCount),
    totalMatching: Number(totalMatching),
    // The server writes `String(boolean)`, so this is exactly "true" or "false".
    truncated: truncated === "true",
  };
}

function readFilename(headers: Record<string, unknown>): string | null {
  const disposition = headerValue(headers, "content-disposition");
  if (disposition === null) return null;
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match ? match[1] : null;
}
