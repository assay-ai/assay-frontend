import type { CursorPage, ListQuery } from "@/interfaces";

import { api } from "./api";

/**
 * Verdict reads for the receipt screens. Added because no existing service covers `/verdicts`,
 * and the evidence pack behind a verdict is the ONLY place the request and
 * response bodies exist. The receipt screen's "Request and response" panel
 * cannot be built without it — `GET /receipts/{intentId}` carries neither.
 *
 * The awkward part is `resolveVerdictIdForIntent`. `GET /verdicts` has filters
 * for tool, provider, status, sampled and policy — but NOT for `intentId`, and
 * `search` is accepted and ignored (verified against the running API: searching
 * for an intent id that is not in the data still returns every row). So the
 * receipt screen has to page the feed and match client-side. That is a real
 * defect in the API surface, not a preference.
 */

export interface VerdictListItem {
  id: string;
  intentId: string;
  toolId: string;
  providerId: string | null;
  verdictStatus: string | null;
  reasonCode: string | null;
  score: number | null;
  sampled: boolean | null;
  state: string;
  createdAt: string;
}

export interface VerdictEvidence {
  id: string;
  intentId: string;
  toolId: string;
  providerId: string | null;
  state: string;
  /** The request body as sent to the provider. */
  request: unknown;
  /** What came back. The empty array on a failed call is visible here. */
  response: unknown;
  outputSchema: unknown;
  stageResults: unknown[];
  sampling?: unknown;
  pinnedPolicy?: unknown;
  evaluatedAt: string | null;
  createdAt: string;
}

export interface ListVerdictsQuery extends ListQuery {
  from?: string;
  to?: string;
  verdictStatus?: string[];
  toolId?: string;
  providerId?: string;
  sampled?: boolean;
  policyId?: string;
}

/** GET /verdicts — the verdict feed, newest first. */
export function listVerdicts(query: ListVerdictsQuery = {}): Promise<CursorPage<VerdictListItem>> {
  return api.get<CursorPage<VerdictListItem>>("/verdicts", query as Record<string, unknown>);
}

/** GET /verdicts/{id}/evidence — request, response, stage results, sampling proof. */
export function getVerdictEvidence(id: string): Promise<VerdictEvidence> {
  return api.get<VerdictEvidence>(`/verdicts/${id}/evidence`);
}

/**
 * Find the verdict for one payment intent, the only way the API allows: read
 * the feed and match. Deliberately bounded to one page — a receipt screen must
 * not walk an unbounded feed, so an older call simply reports no evidence
 * rather than hanging.
 */
export async function resolveVerdictIdForIntent(intentId: string): Promise<string | null> {
  const page = await listVerdicts({ limit: 100 });
  return page.items.find((v) => v.intentId === intentId)?.id ?? null;
}
