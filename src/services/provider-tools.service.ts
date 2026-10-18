import type { CursorPage } from "@/interfaces/api";

import { api } from "./api";

/**
 * "Publish your own API" (design spec §7.6, §7.10): a provider's own tools,
 * named `{handle}__{tool}`. Shapes follow the backend's
 * `provider-tool/dto/provider-tools.dto.ts`, field for field.
 *
 * Every route is person-only (an agent key is refused). Another
 * organization's tool is the same 404 as one that does not exist.
 *
 * Errors (`ApiError.code`, `ApiError.context`):
 *   TOOL_PROVIDER_TOOL_INVALID     400  `problems`, `findings`
 *   TOOL_PROVIDER_TOOL_NOT_ALLOWED 403  `reason` NOT_PROVIDER | NO_HANDLE
 *   TOOL_PROVIDER_TOOL_NAME_TAKEN  409  `name`, `suggestion`
 *   TOOL_PROVIDER_TOOL_GATE_FAILED 409  `failed`, `findings`
 *   TOOL_PROVIDER_TOOL_IN_REVIEW   409  `reviewVersion`
 *   TOOL_PROVIDER_TOOL_STATE       409  `reason`
 */

export type ProviderToolVisibility = "PRIVATE" | "UNLISTED" | "LISTED";
export type ProviderToolStatus = "DRAFT" | "ACTIVE" | "DEPRECATED" | "RETIRED" | "REMOVED";
export type ProviderToolVersionStatus = "DRAFT" | "ACTIVE" | "DEPRECATED" | "RETIRED";
export type ReviewStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";
export type ReviewKind = "FIRST" | "CHANGE";
export type ReviewDisplayState = "NOT_SUBMITTED" | "IN_REVIEW" | "CHANGES_IN_REVIEW" | "REJECTED" | "CHANGES_REJECTED" | "LISTED";

export interface ProviderToolReview {
  status: ReviewStatus;
  state: ReviewDisplayState;
  /** The backend's own words, e.g. "Changes in review; v1.0.0 still serving". */
  label: string;
  kind: ReviewKind | null;
  reviewVersion: number | null;
  reviewSemver: string | null;
  /** Shown when rejected: why, and what to fix. */
  note: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  approvedVersion: number | null;
  approvedSemver: string | null;
}

export interface ProviderToolSummary {
  id: string;
  /** What an agent calls: `acme__search_posts`. */
  name: string;
  localName: string;
  handle: string;
  /** The name behind a client prefix: `mcp__acme__acme__search_posts`. */
  preview: string;
  category: string;
  tags: string[];
  visibility: ProviderToolVisibility | string;
  status: ProviderToolStatus | string;
  currentSemver: string | null;
  currentVersion: number | null;
  hasDraft: boolean;
  /** The "Not reviewed" badge: no version approved yet. */
  notReviewed: boolean;
  review: ProviderToolReview;
  replacementToolId: string | null;
  replacementName: string | null;
  /** Set when taken down. */
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScreenFindingCode =
  | "CONTRACT_INVALID"
  | "TEXT_TOO_LONG"
  | "INSTRUCTION_PATTERN"
  | "HIDDEN_CHARACTERS"
  | "SECRET_INPUT"
  | "REMOTE_REF"
  | "SCHEMA_TOO_COMPLEX"
  | "EXAMPLE_MISMATCH"
  | "RULES_INVALID";

export interface ScreenFinding {
  code: ScreenFindingCode | string;
  /** JSON-pointer-ish: `inputSchema/properties/q/description`. */
  location: string;
  detail: string;
}

export interface ProviderToolVersion {
  version: number;
  semver: string;
  major: number;
  status: ProviderToolVersionStatus | string;
  summary: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  optionalInputFields: string[];
  optionalOutputFields: string[];
  examples: unknown[];
  rules: unknown[];
  tier: "UNVERIFIED" | "VERIFIED" | string;
  changelog: string | null;
  sunsetAt: string | null;
  publishedAt: string | null;
  isCurrent: boolean;
  approved: boolean;
}

export interface ProviderToolDraft extends ProviderToolVersion {
  baseSemver: string | null;
  bump: "MAJOR" | "MINOR" | "PATCH" | null;
  /** The schema diff against the base version. */
  changes: unknown[];
  /** What stops it from being published at all. */
  problems: string[];
  /** What the publish gate's schema screen would refuse. */
  screen: ScreenFinding[];
  /** Frozen: a review of this draft is pending. */
  inReview: boolean;
  updatedAt: string;
}

export interface ProviderToolBindingRef {
  bindingId: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "SUSPENDED" | string;
  mappingVersion: number;
  publishedVersion: number | null;
}

export interface ProviderToolQuality {
  windowDays: number;
  calls: number;
  schemaFailures: number;
  schemaPassRate: number | null;
  rulesJudged: number;
  rulesFailed: number;
  rulesPassRate: number | null;
  slaVerifiedCalls: number;
  slaFailedCalls: number;
  slaFailureRate: number | null;
  disputesDecided: number | null;
  disputesUpheld: number | null;
  quality: number | null;
  maxTier: "UNVERIFIED" | "VERIFIED" | string;
}

export interface ProviderTool extends ProviderToolSummary {
  /** Published versions, newest first. */
  versions: ProviderToolVersion[];
  draft: ProviderToolDraft | null;
  /** The one implementation; created with the listing wizard. */
  binding: ProviderToolBindingRef | null;
  /** `https://mcp.assay.ai/@acme` once a tool is LISTED. */
  mcpUrls: { handle: string | null };
  quality: ProviderToolQuality;
  /** The earliest `sunsetAt` a deprecation accepts if sent now (now + the 90-day minimum, UTC). */
  earliestSunsetAt: string;
  /** The tool's own takedown while it stands, as told to the provider (never the operator's note); null otherwise. */
  takedown: ProviderToolTakedown | null;
}

export interface ProviderToolTakedown {
  at: string;
  /** IMPERSONATION, MODEL_INSTRUCTIONS, SECRET_COLLECTION, HARMFUL_OUTPUT, LEGAL_REQUEST, POLICY_VIOLATION; null on an old takedown. */
  reasonCode: string | null;
  reasonLabel: string | null;
  /** A note the operator wrote for the provider. */
  publicNote: string | null;
}

export type GateRequirementCode =
  | "PROVIDER_ACTIVE"
  | "HANDLE_ACTIVE"
  | "PUBLISHED_VERSION"
  | "BINDING_PUBLISHED"
  | "TESTER_RUN"
  | "TESTER_PASSED"
  | "PAYOUT_ACCOUNT"
  | "STAKE_AT_MINIMUM_ON_EVERY_CHAIN"
  | "SCHEMA_SCREEN"
  | "EXAMPLES_MATCH_SCHEMA";

export interface GateRequirement {
  requirement: GateRequirementCode | string;
  met: boolean;
  code: string | null;
  detail: string | null;
}

export interface ProviderToolGate {
  passed: boolean;
  /** Stable order. */
  requirements: GateRequirement[];
  /** One per screened version. */
  screen: { version: number; semver: string; findings: ScreenFinding[] }[];
}

/** What a provider writes for one version: everything here reaches a model. */
export interface ProviderToolContractBody {
  summary: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  optionalInputFields?: string[];
  optionalOutputFields?: string[];
  examples?: Record<string, unknown>[];
  rules?: Record<string, unknown>[];
  changelog?: string;
  category?: string;
  tags?: string[];
  /** Draft a change to an older major. */
  baseVersion?: number;
}

export interface CreateProviderToolBody extends ProviderToolContractBody {
  /** The `{tool}` half of `{handle}__{tool}`. */
  name: string;
  category: string;
}

export interface BindingPrefill {
  endpoint: string;
  requestMapping: Record<string, unknown>;
  responseMapping: Record<string, unknown>;
  pricingMode: string;
  priceAmount: string;
  assetId: string;
  settlementChains: string[];
  timeoutMs: number;
  /** NONE, API_KEY, SIGNATURE or BOTH. API_KEY and BOTH: add the credential to the new listing before its test (it is never copied). */
  authMode: "NONE" | "API_KEY" | "SIGNATURE" | "BOTH" | string;
  /** The failure rate the provider tool's listing already declares for this endpoint. */
  slaFailureRate: number;
}

export interface PromotionInvitation {
  standardToolId: string;
  standardToolName: string;
  standardToolStatus: string;
  /** Your provider tool it was drafted from or matched. */
  sourceToolId: string;
  sourceToolName: string;
  invitedAt: string;
  /** You already have a binding for the standard tool. */
  bound: boolean;
  /** Your provider tool's endpoint, mappings and price, to start a listing of the standard tool from. */
  prefill: BindingPrefill | null;
}

const base = (id: string) => `/provider/tools/${encodeURIComponent(id)}`;

export function listProviderTools(query: { limit?: number; cursor?: string } = {}): Promise<CursorPage<ProviderToolSummary>> {
  const params: Record<string, unknown> = { limit: query.limit ?? 50 };
  if (query.cursor) params.cursor = query.cursor;
  return api.get<CursorPage<ProviderToolSummary>>("/provider/tools", params);
}

/** Created PRIVATE, with a DRAFT 1.0.0 of the contract. */
export function createProviderTool(body: CreateProviderToolBody): Promise<ProviderTool> {
  return api.post<ProviderTool>("/provider/tools", body);
}

export function getProviderTool(id: string): Promise<ProviderTool> {
  return api.get<ProviderTool>(base(id));
}

export function updateProviderTool(id: string, body: { category?: string; tags?: string[] }): Promise<ProviderTool> {
  return api.patch<ProviderTool>(base(id), body);
}

/** The publish gate: binding test, stake, payout and the schema screen. */
export function getProviderToolGate(id: string): Promise<ProviderToolGate> {
  return api.get<ProviderToolGate>(`${base(id)}/publish-check`);
}

/** Save the draft version (create or replace). 409 IN_REVIEW while a review is pending. */
export function saveProviderToolDraft(id: string, body: ProviderToolContractBody): Promise<ProviderTool> {
  return api.post<ProviderTool>(`${base(id)}/versions`, body);
}

export function discardProviderToolDraft(id: string): Promise<ProviderTool> {
  return api.delete<ProviderTool>(`${base(id)}/versions/draft`);
}

/** PRIVATE: at once. UNLISTED: through the gate. LISTED: goes to review. */
export function publishProviderToolVersion(id: string, version: number): Promise<ProviderTool> {
  return api.post<ProviderTool>(`${base(id)}/versions/${version}/publish`);
}

/**
 * Deprecate a major other than the current one; `sunsetAt` at least the tool's `earliestSunsetAt`.
 * `replacementToolId`: a serving tool that reaches at least the same audience (409 TOOL_PROVIDER_TOOL_STATE with a reason otherwise).
 */
export function deprecateProviderToolMajor(id: string, version: number, sunsetAt: string, replacementToolId?: string | null): Promise<ProviderTool> {
  return api.post<ProviderTool>(`${base(id)}/versions/${version}/deprecate`, { sunsetAt, ...(replacementToolId ? { replacementToolId } : {}) });
}

/** "Anyone with the link" (UNLISTED, "Not reviewed"), through the gate. Locks the public name. */
export function shareProviderToolUnlisted(id: string): Promise<ProviderTool> {
  return api.post<ProviderTool>(`${base(id)}/publish`, { visibility: "UNLISTED" });
}

/** "Listed in the catalogue": submit for review, through the gate. */
export function submitProviderToolReview(id: string): Promise<ProviderTool> {
  return api.post<ProviderTool>(`${base(id)}/review`);
}

export function withdrawProviderToolReview(id: string): Promise<ProviderTool> {
  return api.post<ProviderTool>(`${base(id)}/review/withdraw`);
}

/** Point to the standard tool that replaces this one (after promotion), or clear it with `null`. */
export function setProviderToolReplacement(id: string, replacementToolId: string | null): Promise<ProviderTool> {
  return api.put<ProviderTool>(`${base(id)}/replacement`, { replacementToolId });
}

/** Stop sharing: UNLISTED back to PRIVATE. 409 when LISTED or a review is pending. */
export function unpublishProviderTool(id: string): Promise<ProviderTool> {
  return api.post<ProviderTool>(`${base(id)}/unpublish`);
}

/** `POST /provider/tools/try`: exactly one of `curl` and `openapi`. */
export interface TryProviderToolBody {
  curl?: string;
  openapi?: string;
  operationId?: string;
  input?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type TryWarningCode = "CREDENTIAL_DETECTED" | "OPTION_IGNORED" | "MISSING_TEST_VALUES" | "AUTH_REQUIRED" | "NOT_SUPPORTED" | "NO_JSON_RESPONSE" | "EXAMPLE_TOO_LARGE";

export interface ProviderToolTryResult {
  source: string;
  ran: boolean;
  passed: boolean;
  ranAt: string;
  request: { method: string; url: string; headerNames: string[] };
  upstream: { status: number; latencyMs: number; contentType: string | null; bodyKind: string; body: unknown; transportError: { kind: string; detail: string | null } | null } | null;
  inferred: {
    endpoint: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown> | null;
    examples: Record<string, unknown>[];
    requestMapping: Record<string, unknown>;
    responseMapping: Record<string, unknown> | null;
    operationId: string | null;
  };
  warnings: { code: TryWarningCode | string; detail: string }[];
}

/** One real call from a curl command or an OpenAPI operation; nothing is stored. */
export function tryProviderTool(body: TryProviderToolBody): Promise<ProviderToolTryResult> {
  return api.post<ProviderToolTryResult>("/provider/tools/try", body);
}

export function listPromotionInvitations(): Promise<{ invitations: PromotionInvitation[] }> {
  return api.get<{ invitations: PromotionInvitation[] }>("/provider/tools/invitations");
}

export function dismissPromotionInvitation(standardToolId: string, sourceToolId: string): Promise<void> {
  return api.post<void>(
    `/provider/tools/invitations/${encodeURIComponent(standardToolId)}/${encodeURIComponent(sourceToolId)}/dismiss`,
  );
}
