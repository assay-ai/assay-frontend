import { toTwoPersonAnswer, type TwoPersonAnswer } from "@/features/operator/two-person";
import type { ApprovalQueued } from "@/interfaces/operator";

import { operatorApi } from "./operator-api";
import type {
  GateRequirement,
  ProviderTool,
  ProviderToolGate,
  ProviderToolVersion,
  ReviewKind,
  ReviewStatus,
  ScreenFinding,
} from "./provider-tools.service";

/**
 * Provider tool review, takedown and promotion — the operator's side of
 * "Publish your own API" (design spec §7.6, §7.5, §7.9 Operator). Shapes
 * follow `provider-tool-review.dto.ts`, `tool-promotion.dto.ts` and
 * `operator-moderation.dto.ts`.
 *
 *   GET  /operator/reviews?pending=           the queue
 *   GET  /operator/reviews/:id                content, its hash, diff, checklist, gate
 *   POST /operator/reviews/:id                A-24: approve or reject, for the hash read
 *   POST /operator/tools/:id/takedown         A-25: at once; a second operator confirms in 72 h
 *   GET  /operator/cutoffs?pending=           delists and takedowns
 *   POST /operator/cutoffs/:id/confirm        A-18
 *   POST /operator/cutoffs/:id/revert         A-19 (lifting a confirmed one: 202, two-person)
 *   GET  /operator/promotions                 groups of similar provider tools
 *   POST /operator/promotions                 draft a standard contract and invite
 *   GET/POST /operator/promotions/:std/invites
 *
 * A decision for a hash other than the stored content's is
 * `TOOL_REVIEW_STALE` (409); nothing pending is `TOOL_REVIEW_NOT_PENDING`.
 */

export interface ReviewQueueItem {
  toolId: string;
  name: string;
  handle: string;
  organizationId: string;
  category: string;
  visibility: string;
  status: ReviewStatus | string;
  /** FIRST: never approved. CHANGE: a listed tool's new version. */
  kind: ReviewKind | string;
  reviewVersion: number | null;
  reviewSemver: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
}

export type ReviewChecklistCode = "NO_IMPERSONATION" | "NO_MODEL_INSTRUCTIONS" | "NO_SECRET_INPUTS" | "EXAMPLES_MATCH_SCHEMA" | "PRICING_CLEAR";

export interface ReviewChecklistItem {
  item: ReviewChecklistCode | string;
  /** PASS/FAIL: the screen decided. CHECK: the operator decides. */
  automated: "PASS" | "FAIL" | "CHECK";
  detail: string;
  findings: ScreenFinding[];
}

export interface ReviewDetail {
  tool: ProviderTool;
  kind: ReviewKind | string;
  /** A decision can be made. */
  pending: boolean;
  /** SHA-256 of the content under review now: sent back with the decision. */
  contentHash: string;
  /** FIRST: every version the tool serves. CHANGE: the draft submitted. */
  covered: ProviderToolVersion[];
  /** CHANGE: the schema diff against the approved version. */
  changes: unknown[];
  checklist: ReviewChecklistItem[];
  gate: ProviderToolGate;
}

/** The review's reason: APPROVED, or the §7.6 checklist item a rejected tool fails. Free text is refused. */
export type ReviewReasonCode = "APPROVED" | "IMPERSONATION" | "MODEL_INSTRUCTIONS" | "SECRET_INPUTS" | "EXAMPLES_MISMATCH" | "PRICING_UNCLEAR";

export interface ReviewDecisionBody {
  decision: "APPROVE" | "REJECT";
  contentHash: string;
  /** Required to reject: what the provider sees, and what to fix. */
  note?: string;
  tier?: "UNVERIFIED" | "VERIFIED";
  reasonCode: ReviewReasonCode;
  ticketRef?: string;
}

export interface ReviewDecisionResult {
  toolId: string;
  decision: "APPROVE" | "REJECT";
  kind: ReviewKind | string;
  approvedVersion: number | null;
}

/** The body every moderation action carries into the override register. */
export interface ModerationBody {
  reasonCode: string;
  /** 20–1000 characters. */
  note: string;
  ticketRef?: string;
  reportId?: string;
}

export interface ModerationCutoff {
  id: string;
  targetType: "TOOLSET" | "HANDLE" | "TOOL" | string;
  targetId: string;
  /** A tool's name, a toolset's name or the handle; null when the target no longer exists. */
  targetName: string | null;
  action: "DELIST" | "TAKEDOWN" | string;
  actedBy: string;
  actedAt: string;
  /** Reverted automatically unless confirmed by then. */
  confirmBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  revertedAt: string | null;
  revertReason: "EXPIRED" | "REJECTED" | "LIFTED" | "REASSIGNED" | string | null;
  reportId: string | null;
  note: string;
}

export interface PromotionCandidate {
  toolId: string;
  name: string;
  handle: string;
  organizationId: string;
  category: string;
  visibility: string;
  semver: string;
  summary: string;
  inputFields: string[];
  outputFields: string[];
  /** Already points to a standard tool. */
  replacementToolId: string | null;
}

export interface PromotionGroup {
  category: string;
  tools: PromotionCandidate[];
}

export interface SimilarTool extends PromotionCandidate {
  similarity: { score: number; name: number; inputs: number; outputs: number };
}

export interface PromotionInvite {
  standardToolId: string;
  sourceToolId: string;
  sourceToolName: string;
  organizationId: string;
  invitedAt: string;
  dismissedAt: string | null;
  bound: boolean;
}

export interface DraftPromotionBody {
  sourceToolId: string;
  /** snake_case, no "__". */
  name: string;
  category?: string;
  inviteToolIds?: string[];
}

export interface DraftPromotionResult {
  tool: { id: string; name: string };
  invites: PromotionInvite[];
}

export type { GateRequirement };

const review = (toolId: string) => `/operator/reviews/${encodeURIComponent(toolId)}`;

export function listProviderToolReviews(pending = true): Promise<ReviewQueueItem[]> {
  return operatorApi.get<ReviewQueueItem[]>("/operator/reviews", { pending });
}

export function getProviderToolReview(toolId: string): Promise<ReviewDetail> {
  return operatorApi.get<ReviewDetail>(review(toolId));
}

export function decideProviderToolReview(toolId: string, body: ReviewDecisionBody): Promise<ReviewDecisionResult> {
  return operatorApi.post<ReviewDecisionResult>(review(toolId), body);
}

/** The reason a provider is told its tool was taken down (a closed list). */
export type TakedownReasonCode = "IMPERSONATION" | "MODEL_INSTRUCTIONS" | "SECRET_COLLECTION" | "HARMFUL_OUTPUT" | "LEGAL_REQUEST" | "POLICY_VIOLATION";

/** The register body, plus what the provider is told: `note` stays internal; `publicNote` (at most 500) is for the provider. */
export interface TakedownToolBody extends ModerationBody {
  publicReasonCode: TakedownReasonCode;
  publicNote?: string;
}

export function takedownProviderTool(toolId: string, body: TakedownToolBody): Promise<ModerationCutoff> {
  return operatorApi.post<ModerationCutoff>(`/operator/tools/${encodeURIComponent(toolId)}/takedown`, body);
}

export function listCutoffs(query: { pending?: boolean; targetType?: "TOOLSET" | "HANDLE" | "TOOL" } = {}): Promise<ModerationCutoff[]> {
  const params: Record<string, unknown> = {};
  if (query.pending !== undefined) params.pending = query.pending;
  if (query.targetType) params.targetType = query.targetType;
  return operatorApi.get<ModerationCutoff[]>("/operator/cutoffs", params);
}

export function confirmCutoff(id: string, body: ModerationBody): Promise<ModerationCutoff> {
  return operatorApi.post<ModerationCutoff>(`/operator/cutoffs/${encodeURIComponent(id)}/confirm`, body);
}

/** Reject a pending takedown (200), or lift a confirmed one (202: waits for a second operator). */
export async function revertCutoff(id: string, body: ModerationBody): Promise<TwoPersonAnswer<ModerationCutoff>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<ModerationCutoff | ApprovalQueued>(`/operator/cutoffs/${encodeURIComponent(id)}/revert`, body),
  );
}

export function listPromotionGroups(): Promise<{ groups: PromotionGroup[] }> {
  return operatorApi.get<{ groups: PromotionGroup[] }>("/operator/promotions");
}

export function listSimilarTools(toolId: string): Promise<{ tools: SimilarTool[] }> {
  return operatorApi.get<{ tools: SimilarTool[] }>(`/operator/promotions/similar/${encodeURIComponent(toolId)}`);
}

export function draftPromotion(body: DraftPromotionBody): Promise<DraftPromotionResult> {
  return operatorApi.post<DraftPromotionResult>("/operator/promotions", body);
}

export function listPromotionInvites(standardToolId: string): Promise<{ invites: PromotionInvite[] }> {
  return operatorApi.get<{ invites: PromotionInvite[] }>(`/operator/promotions/${encodeURIComponent(standardToolId)}/invites`);
}

export function invitePromotion(standardToolId: string, toolIds: string[]): Promise<{ invites: PromotionInvite[] }> {
  return operatorApi.post<{ invites: PromotionInvite[] }>(`/operator/promotions/${encodeURIComponent(standardToolId)}/invites`, { toolIds });
}
