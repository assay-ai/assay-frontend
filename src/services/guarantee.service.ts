import type { CursorPage, ListQuery } from "@/interfaces";

import { api } from "./api";

/**
 * Guarantee-screen reads. `GET /verdicts` is the only endpoint that carries a
 * `reasonCode`, which is the column the Guarantee screen's "Why calls failed" table is built
 * on — no aggregate-by-reason endpoint exists, so the screen pages this and
 * folds it client-side.
 *
 * Deliberately not re-exported from `src/services/index.ts`; see the note
 * there.
 */

export interface VerdictRow {
  id: string;
  intentId: string;
  toolId: string;
  providerId: string | null;
  /** Wider than the OpenAPI enum in the same way `ToolCallDto.verdict` is. */
  verdictStatus: string;
  /** e.g. `insufficient_results`, `stale_data`, `no_decision_policy`. */
  reasonCode: string | null;
  score: number | null;
  sampled: boolean;
  decisionPolicyId: string;
  decisionPolicyVersion: number;
  state: string;
  createdAt: string;
}

export interface ListVerdictsQuery extends ListQuery {
  from?: string;
  to?: string;
  search?: string;
  verdictStatus?: string[];
  toolId?: string;
  providerId?: string;
  sampled?: boolean;
  policyId?: string;
}

/**
 * GET /verdicts — the Guarantee screen's "Why calls failed".
 *
 * `verdictStatus` is COMMA-JOINED before it goes out. Axios serialises an array
 * as `verdictStatus[]=FAIL`, and the API rejects that with
 * `VALIDATION_FAILED: property verdictStatus[] should not exist` — verified
 * against the running service. Repeated keys and a comma-joined value both
 * work; a comma-joined value is the one shape axios will not mangle. The same
 * bug is latent in `listToolCalls`'s `status` / `verdict` filters, which live
 * in a service this group must not edit — reported to the parent.
 */
export function listVerdicts({ verdictStatus, ...query }: ListVerdictsQuery = {}): Promise<
  CursorPage<VerdictRow>
> {
  return api.get<CursorPage<VerdictRow>>("/verdicts", {
    ...query,
    ...(verdictStatus?.length ? { verdictStatus: verdictStatus.join(",") } : {}),
  });
}
