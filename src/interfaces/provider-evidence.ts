/**
 * `GET /providers/me/verdicts/:id/evidence` (the evidence pack screen).
 *
 * Verified against a running local API with the demo provider token rather than transcribed from the Swagger DTO
 * alone — the wire omits several fields the backend's own
 * `ProviderVerdictEvidenceDto` class declares (see the notes below) because
 * `class-transformer` drops `undefined`, and the sealer never wrote them.
 *
 * This is the CALL-level evidence pack. The product design also describes a
 * WINDOW-level pack — tabs for many verdicts, passing/failed/excluded samples,
 * a window's pinned policy, "Prior windows" — which composes many calls'
 * packs together and is not built yet. This route and these types are the
 * one call-level pack that DOES exist today.
 */

/** The four pipeline stages, always present, in pipeline order. */
export type EvidenceVerificationStage =
  | "SCHEMA"
  | "DETERMINISTIC_RULES"
  | "CROSS_CHECK"
  | "SEMANTIC";

/**
 * Eight statuses. Only `PASSED` may ever be read as a tick — see
 * `src/features/provider-evidence/stage-format.ts`, which collapses these
 * onto the four `StageList` draws and never lets a non-`PASSED` status read
 * as passed.
 */
export type EvidenceStageStatus =
  | "PASSED"
  | "FAILED"
  | "NOT_REACHED"
  | "NOT_APPLICABLE"
  | "NOT_IMPLEMENTED"
  | "MISAPPLIED"
  | "SKIPPED"
  | "UNAVAILABLE";

export type EvidenceRuleOutcome = "PASSED" | "FAILED" | "NOT_APPLICABLE" | "MISAPPLIED";

/** One deterministic rule's result, behind `DETERMINISTIC_RULES`'s score. */
export interface EvidenceRuleResult {
  ruleId: string;
  type: string;
  outcome: EvidenceRuleOutcome;
  /** This rule's weight in the stage's score. */
  weight: number;
  code: string | null;
  detail: string | null;
  /** JSON pointer into the response — where the rule looked. */
  pointer: string | null;
}

export interface EvidenceStageResult {
  stage: EvidenceVerificationStage;
  status: EvidenceStageStatus;
  code: string | null;
  detail: string | null;
  score: number | null;
  /**
   * Present only on `DETERMINISTIC_RULES` in the payloads seen — the DTO does
   * not declare it (it is `unknown` server-side, copied straight from
   * `core.stages`), so treat it as optional wire content, not a contract.
   */
  rules?: EvidenceRuleResult[];
}

/** The sample-selection proof — reproducible via `sampleSelector`. */
export interface EvidenceSamplingProof {
  sampleRate: number | null;
  sampled: boolean | null;
  sampleSelector: number | null;
  sampleDisplay: string | null;
}

/** The policy pinned to this verdict, at the version it was judged under. */
export interface EvidencePinnedPolicy {
  policyId: string;
  policyVersion: number;
  lifecycle: string | null;
  decisionDocument: Record<string, unknown>;
  verificationDocument: Record<string, unknown> | null;
}

/**
 * The provider's integrity view — deliberately narrower than the buyer's.
 *
 * **No `seq`, no `prevHash`.** The chain position is the buying
 * organization's count of its own verdicts; the provider has no business
 * learning that number (`ProviderEvidenceIntegrityDto` on the backend). If a
 * future API response ever adds either field back, do not render it —
 * report it instead.
 *
 * **No `signature`, no `verifierKey`.** The design's "Attestation" tab
 * draws both; neither exists on the wire. No verifier signs `contentHash`
 * yet (deferred: nothing calls the signing key for evidence). Render only what is real: the hash, when it was sealed,
 * and whether the bodies are still kept.
 */
export interface ProviderEvidenceIntegrity {
  sealed: boolean;
  /** sha256 of the canonical core, recomputed on every read. */
  contentHash: string;
  sealedAt: string;
  /** `RAW` while bodies are kept; `DIGESTED` once retention has scrubbed them. */
  bodyState: "RAW" | "DIGESTED";
}

/** The digests of the raw bodies, which outlive the bodies themselves. */
export interface EvidenceBodyDigests {
  /** `sha256:…`, or null when there was no body at all (distinct from scrubbed). */
  request: string | null;
  response: string | null;
}

export interface ProviderVerdictEvidence {
  id: string;
  intentId: string;
  toolId: string;
  /** Null once retention has scrubbed the body, or when there was none. */
  request: unknown;
  response: unknown;
  stageResults: EvidenceStageResult[];
  sampling: EvidenceSamplingProof;
  /** Null only while the record is still `PENDING`. */
  pinnedPolicy: EvidencePinnedPolicy | null;
  evaluatedAt: string | null;
  integrity: ProviderEvidenceIntegrity;
  bodyDigests: EvidenceBodyDigests;
}
