import type { SlashDisputeClaimType } from "@/interfaces/provider-disputes";

/**
 * The dispute form's seven claim sentences, taken verbatim from two places that agree
 * word for word: the design and the one-line docstring on
 * each `DisputeClaimType` member in
 * assay-backend `src/modules/slash/domain/arbitration.ts` — that file's own
 * comment says these docstrings **are** the copy. Order matches both.
 */
export const CLAIM_TYPE_SENTENCE: Record<SlashDisputeClaimType, string> = {
  PLATFORM_MAPPING_CHANGE: "The failures were caused by a platform mapping change",
  AGENT_GRIEFING: "The failures came from one agent's query pattern (griefing)",
  POLICY_DEFECT: "The policy misjudges a legitimate response (policy defect)",
  INSUFFICIENT_SAMPLE: "The sample is too small to support this conclusion",
  UPSTREAM_INDUCED: "The failing calls' inputs came from another tool's output",
  DECLARED_INCIDENT: "We had a declared incident during this window",
  OTHER: "Other",
};

/** True for a value this app knows is one of the seven — narrows a free-form `Dispute.claimType` string. */
export function isSlashClaimType(value: string): value is SlashDisputeClaimType {
  return Object.prototype.hasOwnProperty.call(CLAIM_TYPE_SENTENCE, value);
}

/**
 * Renders a `Dispute.claimType` (a free string on the general resource — see
 * `@/interfaces/provider-disputes`) as the sentence when it happens to be one
 * of the seven, or the raw value otherwise. Never invents a sentence for a
 * value the enum does not define — `POLICY_DEFECT` renders as the sentence;
 * `MAPPING_ERROR` (a value the general `/disputes` DTO's own examples use)
 * renders as itself.
 */
export function claimTypeLabel(claimType: string): string {
  return isSlashClaimType(claimType) ? CLAIM_TYPE_SENTENCE[claimType] : claimType;
}
