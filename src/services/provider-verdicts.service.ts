import type {
  CursorPage,
  ListProviderVerdictsQuery,
  ProviderVerdictDetail,
  ProviderVerdictListItem,
} from "@/interfaces";

import { api } from "./api";

/**
 * `GET /providers/me/verdicts` and `GET /providers/me/verdicts/:id` — the
 * provider's verdict feed and detail.
 *
 * Named `listProviderVerdicts` / `getProviderVerdict`, not `listVerdicts` /
 * `getVerdict`: those two names are already taken on the buyer side
 * (`verdicts.service.ts`, itself not re-exported from the barrel for the
 * same reason — see `src/services/index.ts`'s class comment). This service
 * IS re-exported; picking a colliding name here would have made that
 * comment's "two pairs" into three.
 *
 * A 404 from either route means "no such verdict, or not one this provider
 * served" — the two are indistinguishable on purpose, never 403.
 */
export function listProviderVerdicts(
  query: ListProviderVerdictsQuery = {}
): Promise<CursorPage<ProviderVerdictListItem>> {
  return api.get<CursorPage<ProviderVerdictListItem>>(
    "/providers/me/verdicts",
    query as Record<string, unknown>
  );
}

export function getProviderVerdict(id: string): Promise<ProviderVerdictDetail> {
  return api.get<ProviderVerdictDetail>(`/providers/me/verdicts/${encodeURIComponent(id)}`);
}
