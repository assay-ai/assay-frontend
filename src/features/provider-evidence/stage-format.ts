import type { StageCheck, StageCheckStatus } from "@/components/ui/stage-list";
/**
 * Imported by path, not from the `@/interfaces` barrel: `src/interfaces
 * /provider-evidence.ts` is new and the barrel line that would re-export it
 * is reported to the orchestrator rather than added here (see this feature's
 * report — `src/interfaces/index.ts` is not a file this task owns). Switch
 * this back to `@/interfaces` once that line lands.
 */
import type {
  EvidenceRuleOutcome,
  EvidenceStageResult,
  EvidenceStageStatus,
  EvidenceVerificationStage,
  ProviderVerdictEvidence,
} from "@/interfaces/provider-evidence";

/**
 * The same stage vocabulary `src/features/g30/receipt-state.ts` already
 * built for the buyer's receipt (`toStageChecks`/`STAGE_NAME`/`STAGE_STATUS`).
 * Duplicated rather than imported: that module's `toStageChecks` takes a
 * whole `Receipt` (a different wire shape, g30-owned) and is not exported as
 * a bare stage mapper, so reusing it would mean constructing a fake
 * `Receipt` to satisfy its signature. The mapping itself — eight wire
 * statuses collapsing onto the four `StageList` draws, defaulting anything
 * that is not `PASSED`/`FAILED`/`SKIPPED` to "not reached" — is the same
 * rule in both places because it is the same product rule: a stage that did
 * not run must never read as a tick. Worth lifting to a shared module the
 * next time a third screen needs it.
 */
const STAGE_NAME: Record<EvidenceVerificationStage, string> = {
  SCHEMA: "Response shape",
  DETERMINISTIC_RULES: "Result quality rules",
  CROSS_CHECK: "Independent cross-check",
  SEMANTIC: "Relevance judgement",
};

const STAGE_STATUS: Record<EvidenceStageStatus, StageCheckStatus> = {
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "not-sampled",
  NOT_REACHED: "not-reached",
  NOT_APPLICABLE: "not-reached",
  NOT_IMPLEMENTED: "not-reached",
  MISAPPLIED: "not-reached",
  UNAVAILABLE: "not-reached",
};

/**
 * The four statuses `NOT_REACHED` collapses onto still mean different
 * things, and `StageList`'s own label ("not reached") is fixed and not
 * caller-overridable. This is the supplementary word shown in the row's
 * muted `note` slot so a provider can tell "the pipeline stopped before
 * this" (`NOT_REACHED`) apart from "this ran and the policy says it does
 * not apply here" (`NOT_APPLICABLE`) apart from "nothing implements this
 * check yet" (`NOT_IMPLEMENTED`, the honest word for `SEMANTIC` today —
 * `core.semantic` is null on every record) apart from
 * "this ran, could not judge what it found, and it is not the provider's
 * fault" (`MISAPPLIED`) apart from "this ran, was selected, and our own
 * check failed to complete" (`UNAVAILABLE`).
 */
const NOT_REACHED_NOTE: Partial<Record<EvidenceStageStatus, string>> = {
  NOT_APPLICABLE: "not applicable to this tool",
  NOT_IMPLEMENTED: "not implemented yet",
  MISAPPLIED: "misapplied — not the provider's fault",
  UNAVAILABLE: "unavailable for this call",
};

export function stageCheckStatus(stage: EvidenceStageResult): StageCheckStatus {
  return STAGE_STATUS[stage.status] ?? "not-reached";
}

/** One `EvidenceStageResult` -> one `StageList` row. */
export function toStageCheck(
  stage: EvidenceStageResult,
  sampling: ProviderVerdictEvidence["sampling"]
): StageCheck {
  const status = stageCheckStatus(stage);
  const sampledNote =
    stage.stage === "SEMANTIC" && status === "not-sampled"
      ? (sampling.sampleDisplay ?? undefined)
      : undefined;

  return {
    id: stage.stage,
    name: STAGE_NAME[stage.stage] ?? stage.stage,
    status,
    note: sampledNote ?? NOT_REACHED_NOTE[stage.status],
    detail: stage.detail ?? undefined,
    detailVariant: status === "failed" ? "error" : "info",
  };
}

export function toStageChecks(evidence: ProviderVerdictEvidence): StageCheck[] {
  return evidence.stageResults.map((stage) => toStageCheck(stage, evidence.sampling));
}

const RULE_OUTCOME_LABEL: Record<EvidenceRuleOutcome, string> = {
  PASSED: "passed",
  FAILED: "failed",
  NOT_APPLICABLE: "not applicable",
  MISAPPLIED: "misapplied",
};

export function ruleOutcomeLabel(outcome: EvidenceRuleOutcome): string {
  return RULE_OUTCOME_LABEL[outcome] ?? outcome;
}

/** A uuid, shortened for display — always paired with the full id somewhere copyable. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
