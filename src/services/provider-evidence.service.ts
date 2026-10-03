// Imported by path, not the `@/interfaces` barrel: `provider-evidence.ts` is
// new and its barrel line is reported to the orchestrator rather than added
// here (`src/interfaces/index.ts` is not a file this task owns).
import type { ProviderVerdictEvidence } from "@/interfaces/provider-evidence";

import { api } from "./api";

/**
 * `GET /providers/me/verdicts/{verdictId}/evidence` — the call-level
 * evidence pack for one call this provider served: request/response, every
 * pipeline stage, the sampling proof, the pinned policy, and the content
 * hash to check a local copy against.
 *
 * Named `getProviderVerdictEvidence` rather than the shorter
 * `getVerdictEvidence` because `src/services/index.ts` already has a
 * collision on `listVerdicts` between two other services and deliberately
 * does not `export *` around it — this name is provider-scoped and
 * unambiguous so it can be added to that barrel without reopening the
 * collision. `src/services/verdicts.service.ts` has a same-shaped
 * `getVerdictEvidence` for the BUYER's route; that one still carries `seq`/
 * `prevHash`, this one never does.
 *
 * 404s with `VERIFICATION_EVIDENCE_PACK_NOT_FOUND` for a verdict this
 * provider did not serve, or one sealed before evidence packs shipped
 * — never a fallback view, unlike the buyer's route. 500s with
 * `VERIFICATION_EVIDENCE_PACK_TAMPERED` if the pack no longer hashes to its
 * own stored digest.
 */
export function getProviderVerdictEvidence(verdictId: string): Promise<ProviderVerdictEvidence> {
  return api.get<ProviderVerdictEvidence>(
    `/providers/me/verdicts/${encodeURIComponent(verdictId)}/evidence`
  );
}
