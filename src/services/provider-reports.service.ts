import type {
  ProviderCallsExport,
  ProviderCallsExportMeta,
  ProviderCallsExportQuery,
  ProviderEarnings,
  ProviderEarningsQuery,
  ProviderReconciliation,
  ProviderReconciliationQuery,
} from "@/interfaces";

import { ApiError } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";
import { demoCallsCsv } from "@/libs/demo/fixtures-provider-calls";

import { api } from "./api";
import { sharedRead } from "./shared-reads";
import { getChains } from "./chains.service";
import { pickDisplayAsset, storedDisplayAsset } from "./display-asset";

/**
 * The report sub-resources of `providers/me`.
 *
 * The first three are **not** cursor lists and have no `cursor`/`limit`: a
 * bounded window of daily buckets is small enough to return whole, and a chart
 * wants every bucket in one response. `from` and `to` are required on all
 * four, ISO-8601, `from` inclusive and `to` exclusive.
 */

/**
 * `GET /providers/me/earnings` — earned vs platform fee vs withheld, grouped
 * by day or by tool.
 *
 * The API answers in one asset and refuses (422 `PROVIDER_MULTIPLE_ASSETS`) a
 * window that spans two unless `asset` names one. A caller that names none
 * gets the provider's display asset, learned first from requests that succeed
 * (`providerEarningAssets`), so a page never fires a request that fails.
 * `null` money means the window matched nothing and no asset narrowed it —
 * there is then no asset to denominate a zero in.
 */
export async function getProviderEarnings(query: ProviderEarningsQuery): Promise<ProviderEarnings> {
  const fetch = (q: ProviderEarningsQuery) =>
    api.get<ProviderEarnings>("/providers/me/earnings", q as unknown as Record<string, unknown>);
  const asset =
    query.asset ?? pickDisplayAsset(await providerEarningAssets(), storedDisplayAsset());
  try {
    return await fetch(asset ? { ...query, asset } : query);
  } catch (error) {
    // Only a window wider than the look-back below can still span two assets
    // here: it is answered in the first chain's settlement asset rather than
    // with an error page.
    const multiple = error instanceof ApiError && error.code === "PROVIDER_MULTIPLE_ASSETS";
    if (!multiple || asset) throw error;
    const { chains } = await sharedRead(["chains"], getChains, 60_000);
    const fallback = pickDisplayAsset(
      chains.map((chain) => chain.settlementAsset),
      storedDisplayAsset()
    );
    if (!fallback) throw error;
    return fetch({ ...query, asset: fallback });
  }
}

let earningAssets: { at: number; value: Promise<string[]> } | null = null;

/**
 * The assets a provider's earnings can be shown in, for the asset selector:
 * the settlement assets with calls in the last 31 days when there is more than
 * one, else `[]` (one asset, nothing to choose).
 *
 * Each settlement asset is asked about by name, because the unnamed question
 * is the one the API refuses. Memoised for a few seconds: one screen fires
 * several earnings requests at once and they must all name the same asset.
 */
export function providerEarningAssets(): Promise<string[]> {
  const now = Date.now();
  if (!earningAssets || now - earningAssets.at > 10_000) {
    earningAssets = { at: now, value: lookUpEarningAssets(new Date(now)).catch(() => []) };
  }
  return earningAssets.value;
}

async function lookUpEarningAssets(now: Date): Promise<string[]> {
  const { chains } = await sharedRead(["chains"], getChains, 60_000);
  const candidates = [...new Set(chains.map((chain) => chain.settlementAsset))];
  if (candidates.length < 2) return [];
  const window = {
    from: new Date(now.getTime() - 31 * 86_400_000).toISOString(),
    to: now.toISOString(),
    groupBy: "tool",
  };
  const reports = await Promise.all(
    candidates.map((asset) =>
      api.get<ProviderEarnings>("/providers/me/earnings", { ...window, asset })
    )
  );
  const earned = candidates.filter((_, index) => reports[index].totals.calls > 0);
  return earned.length > 1 ? earned : [];
}

/**
 * `GET /providers/me/reconciliation` — the class breakdown and settlement for a
 * window, aggregated over every call (unlike the per-call CSV, which is capped).
 * Like the earnings report it refuses a window spanning two assets unless
 * `asset` names one, so callers pass the display asset.
 */
export function getProviderReconciliation(
  query: ProviderReconciliationQuery
): Promise<ProviderReconciliation> {
  return api.get<ProviderReconciliation>(
    "/providers/me/reconciliation",
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
 * The export caps itself, and says so in `X-Assay-Export-Row-Count`,
 * `X-Assay-Export-Total-Matching` and `X-Assay-Export-Truncated`, set before the
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
  // The demo stage set: this route skips the JSON envelope, so the fixture table never sees it.
  if (demoEnabled()) {
    const csv = demoCallsCsv();
    const rows = csv.split("\n").length - 1;
    return { csv, meta: { rowCount: rows, totalMatching: rows, truncated: false }, filename: "assay-calls-demo.csv" };
  }
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
    filename: readFilename(headers) ?? callsCsvFilename(query.from, query.to),
  };
}

/**
 * The name the API gives a per-call export, for when `Content-Disposition` is
 * not readable: `assay-calls-<from>_<to>.csv`, with every character outside
 * `[0-9A-Za-z._-]` (the ISO timestamps' colons) turned into "-" — the same rule
 * as the backend's `callsExportFilename`.
 */
export function callsCsvFilename(from: string, to: string): string {
  const safe = (value: string) => value.replace(/[^0-9A-Za-z._-]/g, "-");
  return `assay-calls-${safe(from)}_${safe(to)}.csv`;
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
  const rowCount = headerValue(headers, "x-assay-export-row-count");
  const totalMatching = headerValue(headers, "x-assay-export-total-matching");
  const truncated = headerValue(headers, "x-assay-export-truncated");
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
