"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { exportProviderCalls } from "@/services/provider-reports.service";
import { toast } from "@/utils/toast";

import { parseCallsCsv, type CallRow } from "./csv";

/**
 * The per-call CSV, fetched once per window and shared by the call-classes screen and the provider earnings screen.
 *
 * Both screens read the same file: it is the only provider endpoint that emits
 * a row per call, and `X-Assay-Call-Id` — its first column — is the join key the
 * two screens exist to explain. Fetching it through one query key means the two
 * cannot disagree about the same window, and the download button re-uses the
 * bytes already in the cache rather than asking for them twice.
 *
 * ## The three cap headers, and why `meta` must never be defaulted
 *
 * The export caps itself and says so in `X-Assay-Export-Row-Count`,
 * `X-Assay-Export-Total-Matching` and `X-Assay-Export-Truncated`. A browser can
 * only read a response header the server names in `Access-Control-Expose-Headers`;
 * the API now names all three plus `Content-Disposition` (verified on the wire),
 * so `meta` is populated today. It stays nullable because a `truncated: false`
 * synthesised from an unreadable header would tell a provider their export is
 * complete on exactly the evidence that it might not be.
 *
 * Every consumer therefore has three states to render, not two: capped, whole,
 * and *unknown*.
 */

export interface CallsExportWindow {
  /** ISO-8601, inclusive. */
  from: string;
  /** ISO-8601, exclusive. */
  to: string;
}

/**
 * `enabled`: the export is up to 50 000 rows and the API allows a few a minute
 * per organisation, one at a time, so a screen asks for it only when the
 * person does (a download, a list of calls opened), never on load. Once read it
 * is kept for the window: a second download re-uses the bytes.
 */
export function useCallsExport(window: CallsExportWindow, options: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: ["provider", "calls-export", window.from, window.to],
    queryFn: () => exportProviderCalls(window),
    enabled: options.enabled ?? false,
    staleTime: Infinity,
    retry: 0,
  });

  const rows: CallRow[] = useMemo(
    () => (query.data ? parseCallsCsv(query.data.csv) : []),
    [query.data]
  );

  return { ...query, rows, meta: query.data?.meta ?? null };
}

/**
 * Hands the CSV to the browser as a file.
 *
 * The bytes come from whatever the query already holds, so pressing the button
 * does not re-run an export the screen is already rendering. The cap is
 * reported through a toast rather than a new surface — neither design draws a
 * slot for it, and staying silent about a truncated file is the one thing the
 * no-silent-caps rule forbids.
 */
export function downloadCallsCsv(
  csv: string,
  filename: string | null,
  meta: { rowCount: number; totalMatching: number; truncated: boolean } | null
): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? "assay-calls.csv";
  anchor.click();
  URL.revokeObjectURL(url);

  if (meta?.truncated) {
    toast.warning(
      `Exported ${meta.rowCount.toLocaleString("en-US")} of ${meta.totalMatching.toLocaleString("en-US")} rows — the file is capped.`
    );
  } else if (!meta) {
    toast.info("Export downloaded. Whether it was capped is not visible from the browser.");
  }
}
