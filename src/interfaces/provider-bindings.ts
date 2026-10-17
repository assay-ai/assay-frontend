/**
 * Tool bindings — the provider's own implementations of catalogue tools, plus
 * the mapping validator, the tester and the publish gate.
 *
 * Source: assay-backend `src/modules/provider/dto/{get-tool-bindings,
 * save-tool-binding,pause-tool-binding,publish-tool-binding,test-tool-binding,
 * validate-mapping}.dto.ts`.
 */

import type { ListQuery, Money } from "./api";
import type { ToolContractVersion } from "./contracts";

/**
 * A request or response mapping.
 *
 * The read DTOs declare these `unknown`; what actually arrives is the stored
 * mapping document, an object. The *shape* inside it is open by design — the
 * mapping format is a spec language, not a fixed record — so the honest type
 * is an object of unknown values rather than a modelled interface.
 *
 * That stays true. The `Mapping*Row` types further down do **not** contradict
 * it: they are not a model of the grammar, they are the *editor's projection
 * of* one document — the much smaller thing a table can show and a provider
 * can fill in. The grammar has recursion (`$item`), nesting, per-site
 * policies and an open transform registry; the projection has a flat list of
 * rows with a fixed set of columns. Most mappings fit; a `$from` projection
 * does not, and `canExpressAsRows` in
 * `@/features/provider-binding/mapping-model` is the gate that says so before
 * a row editor is offered. A document that cannot be projected is edited as
 * JSON, still typed `ToolMapping`.
 */
export type ToolMapping = Record<string, unknown>;

export type PricingMode = "FREE" | "FREEMIUM" | "PAID";

/** `DRAFT` is written but never published: not routable, editable freely. */
export type BindingStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "SUSPENDED";

/**
 * Who stopped the traffic — the other half of `PAUSED`, which has two causes
 * with opposite consequences. A provider pausing their own binding is a
 * choice: no penalty, no effect on accrued earnings, nothing in the quality
 * profile. A health circuit opening is a fault, and is recorded as one. The
 * status alone cannot tell them apart, which is why this field exists.
 */
export type BindingPauseReason = "PROVIDER_REQUESTED" | "HEALTH" | "PLATFORM";

/**
 * Sortable field: `createdAt` only, which is also the default.
 *
 * `search` is inherited from `ListQuery` and is **inert here**: the shared
 * query DTO accepts it, but this resource applies no free-text predicate, so
 * a search value is silently ignored rather than rejected. Do not offer a
 * search box against it. (`/verdicts` has the same defect on the buyer side.)
 */
export interface ListToolBindingsQuery extends ListQuery {
  from?: string;
  to?: string;
}

export interface ToolBindingSummary {
  id: string;
  toolId: string;
  endpoint: string;
  pricingMode: PricingMode;
  price: Money;
  status: BindingStatus;
  /** Which stored revision of the request/response mapping this is. */
  version: number;
}

/**
 * How the provider's API knows a request is from Assay. `API_KEY` sends the
 * provider's own static headers, `SIGNATURE` signs each call, `BOTH` does both
 * and `NONE` does neither.
 */
export type BindingAuthMode = "NONE" | "API_KEY" | "SIGNATURE" | "BOTH";

/** One static header the platform sends to the provider's endpoint. */
export interface CredentialHeaderInput {
  name: string;
  value: string;
}

/**
 * The stored credential set for one endpoint origin. Values are never
 * returned: `hint` is a short masked tail, or `null` when there is none.
 */
export interface CredentialSetSummary {
  origin: string;
  headers: { name: string; hint: string | null }[];
  updatedAt: string;
}

export interface ToolBindingDetail extends ToolBindingSummary {
  authMode: BindingAuthMode;
  /**
   * The endpoint the live (published) revision calls, or `null` before the
   * first publish. It can differ from the draft `endpoint`; the live
   * revision's stored credentials must stay until the new address is published.
   */
  publishedEndpoint: string | null;
  /**
   * T3: the contract majors this revision serves, `^1` or `^1 || ^2`. Each
   * needs a green tester run before publishing. Optional for a backend that
   * predates contract versions (reads as `^1`).
   */
  toolVersionRange?: string;
  /** T3: optional outputs this revision promises to return. */
  providesOutputFields?: string[];
  /** T3: optional inputs this revision passes on to its endpoint. */
  supportsInputFields?: string[];
  requestMapping: ToolMapping;
  responseMapping: ToolMapping;
  freeQuotaPerAgent: number | null;
  /**
   * The most free calls this binding serves per day, across all agents. A call
   * count, not money; `null` is the platform default.
   */
  freeDailyBudget: number | null;
  /** The declared failure rate, e.g. 0.05 for 5%. */
  slaFailureRate: number;
  timeoutMs: number;
  /**
   * The two self-declared ceilings. `null` where none was declared, and never
   * `0` — zero is refused on write, because "declared unroutable" is what the
   * pause button says out loud. Reaching a ceiling sheds traffic to another
   * provider; it is not an error, not a strike and not in the quality profile.
   */
  maxRps: number | null;
  maxDailyCalls: number | null;
  /**
   * Which revision is live, or `null` if it has never been published.
   *
   * On the detail DTO rather than only on the save response: the backend
   * moved both of these up, and a frontend that kept them on `SavedToolBinding`
   * would have re-created the exact drift that move removed — a console that
   * knows whether a binding has unpublished edits only immediately after
   * saving it.
   */
  publishedVersion: number | null;
  /** The current revision differs from the published one — edits not yet put live. */
  hasUnpublishedChanges: boolean;
}

/**
 * A saved binding.
 *
 * It adds nothing to {@link ToolBindingDetail} any more — `publishedVersion`
 * and `hasUnpublishedChanges` are on the detail DTO itself. The name is kept
 * because the save/pause/publish responses are documented in terms of it and
 * because the three routes below extend it.
 */
export type SavedToolBinding = ToolBindingDetail;

/**
 * A binding plus the two columns a pause moves. They travel together because
 * they are only ever true together — a console reading "paused" from `status`
 * and "why" from a second request could show the two out of step for exactly
 * as long as that request takes.
 */
export interface PausedToolBinding extends SavedToolBinding {
  /** `null` on a binding that is serving. */
  pauseReason: BindingPauseReason | null;
  pausedAt: string | null;
}

export interface PublishedToolBinding extends SavedToolBinding {
  publishedAt: string;
}

/**
 * `POST /providers/me/tool-bindings`.
 *
 * `priceAmount` is an integer string in minor units, not a number: a price is
 * money, and money crosses this boundary as a string everywhere in this API.
 * `freeDailyBudget` is a call count (a whole number), not money.
 *
 * The two mappings are only shape-checked here. Their real validation runs the
 * same functions the router runs and answers `TOOL_MAPPING_INVALID` with a
 * pointer at the offending node — which is the only kind of message a provider
 * can act on while looking at a mapping editor.
 */
export interface SaveToolBindingBody {
  /** From the catalogue. Immutable after creation. */
  toolId: string;
  /** The provider's own URL. `requestMapping.path` is appended to it. http or https. */
  endpoint: string;
  requestMapping: ToolMapping;
  responseMapping: ToolMapping;
  pricingMode: PricingMode;
  authMode?: BindingAuthMode;
  /** Minor units, digits only. */
  priceAmount: string;
  /** CAIP-19 asset id. */
  assetId: string;
  /**
   * CAIP-2 chains the binding is offered on. REQUIRED on create — the backend
   * refuses a body without it (`VALIDATION_FAILED … settlementChains`), and
   * the create screen never sent it, so no binding could be created from the
   * console at all. Observed against a deployed environment.
   */
  settlementChains: string[];
  /** FREEMIUM only. */
  freeQuotaPerAgent?: number | null;
  /** Free calls per day across all agents, a whole number >= 1; `null` = platform default. */
  freeDailyBudget?: number | null;
  /** 0..1. */
  slaFailureRate: number;
  /** 1..120000. The router may shorten it, never lengthen it. */
  timeoutMs: number;
  /** >= 1, or `null` for no ceiling. `0` is refused. */
  maxRps?: number | null;
  /** >= 1, or `null` for no ceiling. Not a "quota" — that word is the agent's free allowance. */
  maxDailyCalls?: number | null;
  /**
   * T3: the contract majors this binding serves, `^1` or `^1 || ^2`. Defaults
   * to the tool's current major. Each major needs a green tester run.
   */
  toolVersionRange?: string;
  /** T3: the contract's optional output fields this binding returns. */
  providesOutputFields?: string[];
  /** T3: the contract's optional input fields this binding passes to its endpoint. */
  supportsInputFields?: string[];
}

/**
 * `PATCH /providers/me/tool-bindings/:id`. Every field optional except the one
 * that is missing entirely: `toolId`.
 *
 * A binding *is* one provider's implementation of one tool, so re-pointing it
 * would silently re-target every verdict, receipt and dispute that already
 * names it. That is a new binding.
 *
 * `null` clears a nullable ceiling; omitting the key leaves it alone. The two
 * are distinguishable on purpose — do not normalise `undefined` to `null`.
 */
export interface UpdateToolBindingBody {
  endpoint?: string;
  requestMapping?: ToolMapping;
  responseMapping?: ToolMapping;
  pricingMode?: PricingMode;
  authMode?: BindingAuthMode;
  priceAmount?: string;
  assetId?: string;
  freeQuotaPerAgent?: number | null;
  /** Free calls per day across all agents; `null` = platform default. */
  freeDailyBudget?: number | null;
  slaFailureRate?: number;
  timeoutMs?: number;
  maxRps?: number | null;
  maxDailyCalls?: number | null;
  /**
   * T3: the contract majors this binding serves, `^1` or `^1 || ^2`. Defaults
   * to the tool's current major. Each major needs a green tester run.
   */
  toolVersionRange?: string;
  /** T3: the contract's optional output fields this binding returns. */
  providesOutputFields?: string[];
  /** T3: the contract's optional input fields this binding passes to its endpoint. */
  supportsInputFields?: string[];
}

/**
 * The body carries a **note**, not the stored reason. `pauseReason` is always
 * `PROVIDER_REQUESTED` on this route — a column a provider can set is a column
 * that cannot be evidence. Max 280 characters, and it reaches the log only.
 */
export interface PauseToolBindingBody {
  reason?: string;
}

// ── Catalogue ──────────────────────────────────────────────────────────────

/**
 * One platform-defined tool a provider can implement.
 *
 * `inputSchema` and `outputSchema` are JSON Schema documents — their shape is
 * whatever the tool author wrote, not something this frontend models, so they
 * get the same treatment as {@link ToolMapping} above: an object of unknown
 * values rather than an invented `JsonSchema` interface.
 */
export interface CatalogueTool {
  id: string;
  name: string;
  /** What the tool obliges an implementation to return — how a provider picks one. */
  description: string;
  tier: "UNVERIFIED" | "VERIFIED" | "GUARANTEED";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** T3: the contract version unpinned URLs serve, e.g. "2.0.0"; a new binding defaults to its major. */
  currentVersion?: string | null;
  /** T3: every published version, newest first, with its optional fields. */
  versions?: ToolContractVersion[];
}

/** The asset every binding settles in — not a choice, just what `assetId` must be. */
export interface CatalogueSettlementAsset {
  /** CAIP-19 asset id. What `SaveToolBindingBody.assetId` must send. */
  assetId: string;
  symbol: string;
  decimals: number;
}

/**
 * `GET /providers/me/tool-bindings/catalogue` — what a provider picks a tool
 * and an `assetId` from before `POST /providers/me/tool-bindings` can succeed.
 */
export interface ToolCatalogue {
  tools: CatalogueTool[];
  settlementAsset: CatalogueSettlementAsset;
}

// ── Mapping validation ─────────────────────────────────────────────────────

export type MappingDirection = "REQUEST" | "RESPONSE";

/** What the editor posts on a debounce while the provider types. Nothing is written. */
export interface ValidateMappingBody {
  direction: MappingDirection;
  mapping: ToolMapping;
  /** So the error carries the binding context it would live in. */
  toolId?: string;
}

/**
 * What a well-formed mapping looks like from the outside.
 *
 * An invalid mapping does **not** come back here — it raises
 * `TOOL_MAPPING_INVALID` with a pointer, through the ordinary error path.
 * There is no `{ valid: false }` branch to write.
 */
export interface ValidateMappingResponse {
  /** Shorthand resolved, exactly as Save would store it. Normalisation is idempotent. */
  canonical: ToolMapping;
  /** Every selector the mapping reads, in document order. The tester's field list. */
  selectors: string[];
  /** Every named transform used, deduplicated. */
  transforms: string[];
}

// ── The editor's projection of a mapping ───────────────────────────────────

/**
 * A mapping, as a **table of rows**.
 *
 * These types are not the mapping format. They are the shape a row editor can
 * hold: one line per leaf, a fixed set of columns, no recursion. The grammar
 * lives in assay-backend `docs/mapping-format.md` and stays behind
 * {@link ToolMapping}; `@/features/provider-binding/mapping-model` projects a
 * document into these rows (`toRows`), builds a canonical document back out
 * (`fromRows`), and refuses both for a document the projection would not
 * reproduce exactly (`canExpressAsRows`).
 *
 * Deliberately absent, because a row cannot carry them: `$from` projections,
 * `$item` templates and `$onEmpty`. Those documents go to the raw-JSON editor
 * whole.
 */

/** `$onNull`. `PASS` is the format's default and is written as an absent key. */
export type MappingOnNull = "PASS" | "DEFAULT" | "ERROR";

/**
 * One named transform, exactly as the format spells it.
 *
 * This is the grammar's own `TransformStep`, union and all, and it is a union
 * for a reason. `mapping-format.md` §Transforms: the canonical step is
 * `{ "name": "split", "args": { "separator": "," } }`, and *"parameterless
 * steps may be written as a bare string"*. Both forms are legal in a stored
 * document, and the backend preserves whichever the author wrote.
 *
 * So the editor has to preserve it too. Collapsing `"trim"` into
 * `{ "name": "trim", "args": {} }` on the way out is a rewrite, and a rewrite
 * of a document nobody edited raises `mapping_version`, invalidates a green
 * tester run and blocks publish. A flag on the row saying "this one was a
 * bare string" would carry the same information less honestly; mirroring the
 * union costs one `typeof` at the two places that read a name, and
 * `transformStepName` / `transformStepArgs` in
 * `@/features/provider-binding/mapping-model` are those two places.
 *
 * `args` is optional and **absent is not `{}`** — same reason. A step stored
 * as `{ "name": "trim" }` goes back out as `{ "name": "trim" }`.
 */
export type MappingTransformStep = string | { name: string; args?: Record<string, unknown> };

/** Which part of the upstream request a row lands on. */
export type MappingRequestSection = "query" | "headers" | "body";

/**
 * Where a row's value comes from — the `$path` / `$const` choice, made
 * explicit rather than inferred from a string's first two characters.
 *
 * The format's shorthand ("a bare string is a selector when it starts with
 * `$.`") is convenient to type and ambiguous to store, so it survives exactly
 * one function call on the backend. Modelling the choice as a tagged union is
 * what keeps `{ "$const": "$.literally this" }` expressible in the editor.
 */
export type MappingRowSource =
  | { kind: "selector"; selector: string }
  | { kind: "constant"; value: unknown };

/** One row of a response mapping: one key of the tool's `outputSchema`. */
export interface MappingResponseRow {
  /**
   * The key path this row writes, dotted (`current.temperature`). Empty
   * string means the document root is itself a leaf.
   */
  target: string;
  source: MappingRowSource;
  /**
   * Named transforms, in application order — the whole registry, arguments
   * included. `split` and `join` take `{ "separator": "," }`, so a list of
   * bare names would have made every binding that uses one unreachable from
   * the table.
   */
  transforms: MappingTransformStep[];
  /** `$optional`: this field may legitimately be absent, so omit it. */
  optional: boolean;
  /**
   * `$default`. **Absent key and `undefined` are the same thing here and both
   * mean "no default"** — which is not the same as `default: null`, a default
   * of JSON `null`. The format draws that line everywhere; so does this.
   */
  default?: unknown;
  onNull: MappingOnNull;
}

/** One row of a request mapping. Same columns, plus where it lands. */
export interface MappingRequestRow extends MappingResponseRow {
  section: MappingRequestSection;
}

/**
 * A request mapping as the editor holds it.
 *
 * `method` and `path` are **not rows** — a request line is not a field
 * mapping, it has no source, no transform and no optionality — so they get
 * their own place here.
 */
export interface MappingRequestModel {
  direction: "REQUEST";
  method: string | null;
  path: string | null;
  /**
   * Which sections the stored document actually declared, including any that
   * are present but empty. Without this, `fromRows` could not tell a document
   * with `"query": {}` from one with no `query` key, and a save that changed
   * nothing would still change the document.
   */
  sections: MappingRequestSection[];
  rows: MappingRequestRow[];
}

export interface MappingResponseModel {
  direction: "RESPONSE";
  rows: MappingResponseRow[];
}

export type MappingRowModel = MappingRequestModel | MappingResponseModel;

// ── Publish gate ───────────────────────────────────────────────────────────

/**
 * Mirrors assay-backend `src/modules/provider/domain/publish-gate.ts`'s enum. The gate
 * renamed `STAKE_AT_MINIMUM` to `STAKE_AT_MINIMUM_ON_EVERY_CHAIN` and added
 * `PAYOUT_ACCOUNT` while this copy kept the old three, so the checklist
 * printed two raw codes and never rendered the stake shortfall explanation.
 */
export type PublishRequirement =
  | "TESTER_RUN"
  | "TESTER_PASSED"
  | "PAYOUT_ACCOUNT"
  | "STAKE_AT_MINIMUM_ON_EVERY_CHAIN";

export interface PublishRequirementResult {
  requirement: PublishRequirement;
  met: boolean;
  /** Stable reason code when unmet. */
  code: string | null;
  /** The specifics — how much stake is missing, which layer the tester failed at. */
  detail: string | null;
}

/**
 * The checklist is a first-class response, not the body of a 4xx: a provider
 * reads it *before* pressing publish. Pressing anyway raises
 * `PROVIDER_PUBLISH_CHECKS_FAILED` carrying this same list, so the two
 * surfaces cannot disagree.
 */
export interface PublishCheck {
  publishable: boolean;
  /** The revision that would go live. */
  mappingVersion: number;
  /** One entry per requirement, always. */
  requirements: PublishRequirementResult[];
}

// ── The mapping tester ─────────────────────────────────────────────────────

export type BindingTestLayer =
  | "REQUEST_MAPPING"
  | "UPSTREAM"
  | "CLASSIFICATION"
  | "RESPONSE_MAPPING"
  | "VERIFICATION";

/**
 * `INCONCLUSIVE` is **not** a pass: the layer ran and had nothing to judge by.
 * A publish gate that treated it as one would let a binding go live on the
 * strength of a check that never happened.
 */
export type BindingTestLayerStatus = "PASSED" | "FAILED" | "NOT_REACHED" | "INCONCLUSIVE";

export type BindingTestOutcome = "PASSED" | "FAILED";

/**
 * `TOOL_SCHEMA_ONLY` means no policy is registered for this tool, so the run
 * judged the response against the tool's `outputSchema` alone. Production
 * settles such a call *unverified*, which makes this run **stricter** than
 * production — the label is what stops a provider reading it as "verification
 * passed".
 */
export type BindingTestPolicySource = "STORED_POLICY" | "TOOL_SCHEMA_ONLY";

export interface BindingTestLayerResult {
  layer: BindingTestLayer;
  status: BindingTestLayerStatus;
  code: string | null;
  detail: string | null;
  /** AGENT | PLATFORM | PROVIDER — who the platform believes is at fault. */
  fault: string | null;
}

export interface BindingTestUpstream {
  /** `0` when no status was ever received. */
  status: number;
  latencyMs: number;
  /** The raw bytes, truncated. Panel one of three. */
  rawBody: string | null;
  rawBodyTruncated: boolean;
  contentType: string | null;
  /** Set when no status was ever received — a timeout, a refused connection, a TLS failure. */
  transportError: { kind: string; detail: string | null } | null;
}

export type VerificationStage =
  | "SCHEMA"
  | "DETERMINISTIC_RULES"
  | "CROSS_CHECK"
  | "SEMANTIC";

export type VerificationStageStatus =
  | "PASSED"
  | "FAILED"
  | "NOT_REACHED"
  | "NOT_APPLICABLE"
  | "NOT_IMPLEMENTED";

export type VerificationRuleType =
  | "MIN_ARRAY_LENGTH"
  | "REQUIRED_FIELDS"
  | "FRESHNESS"
  | "VALUE_RANGE"
  | "VALID_URL"
  | "NO_DUPLICATES";

export type VerificationRuleOutcome = "PASSED" | "FAILED" | "NOT_APPLICABLE" | "EMPTY_COLLECTION";

export interface VerificationRuleResult {
  ruleId: string;
  type: VerificationRuleType;
  outcome: VerificationRuleOutcome;
  weight: number;
  /** Stable machine-readable reason. `null` on a pass. */
  code: string | null;
  detail: string | null;
  /** Where the violation was found, as a JSON pointer. */
  pointer: string | null;
}

/**
 * One verification stage.
 *
 * The tester DTO declares `stages: readonly unknown[]`; the underlying type is
 * the engine's `StageResult`, modelled here rather than left open. A stage
 * after a failure is `NOT_REACHED` — never `PASSED` and never omitted — and
 * `score` is `null` rather than `0` for the same reason.
 */
export interface VerificationStageResult {
  stage: VerificationStage;
  status: VerificationStageStatus;
  code: string | null;
  detail: string | null;
  score: number | null;
  /** Per-rule breakdown. Only the deterministic stage sets it. */
  rules?: VerificationRuleResult[];
}

export interface BindingTestVerification {
  policySource: BindingTestPolicySource;
  policyId: string | null;
  policyVersion: number | null;
  /** One row per stage, in pipeline order. */
  stages: VerificationStageResult[];
  /** One of `VerdictStatus`. */
  verdict: string | null;
}

/** The response classification. */
export interface BindingTestClassification {
  responseClass: "SYSTEM_ERROR" | "REQUEST_ERROR" | "DATA_RESULT";
  /** e.g. `TRANSPORT_TIMEOUT`, `BODY_NOT_JSON`, `OK`. */
  reason: string;
  detail?: string;
  /** `Retry-After` in ms when the upstream sent one. Advisory, never a delay. */
  retryAfterMs?: number | null;
}

/** What the console posts to run a test: the tool arguments, and nothing else. */
export interface RunBindingTestBody {
  input: Record<string, unknown>;
  /**
   * T3: the contract version (`tool_versions.version`) to test against, inside
   * the binding's range. Defaults to the newest version of the highest major.
   */
  toolVersion?: number;
}

/**
 * One tester run, whole — the three panels in one document.
 *
 * Stored on the run row unchanged and returned to the console unchanged, so
 * what a provider saw and what the publish gate read cannot drift apart.
 * Charges nobody, and writes no payment intent.
 */
export interface BindingTestReport {
  /** The `X-Assay-Call-Id` this run actually sent upstream. Real, and unique. */
  callId: string;
  outcome: BindingTestOutcome;
  failedLayer: BindingTestLayer | null;
  /** Which revision of the mappings this run exercised — the publish gate keys on it. */
  mappingVersion: number;
  /** T3: the contract version this run was checked against (sequence number). */
  toolVersion?: number;
  /** T3: e.g. "1.1.0". */
  toolVersionSemver?: string;
  layers: BindingTestLayerResult[];
  /** Non-blocking findings, e.g. the endpoint answered without credentials. */
  warnings: {
    code: "ACCEPTS_UNSIGNED" | "ACCEPTS_WITHOUT_CREDENTIALS" | "NO_AUTHENTICATION";
    message: string;
  }[];
  /** Header **names** only, never values. */
  request: {
    method: string;
    url: string;
    headerNames: string[];
    body: unknown;
  } | null;
  upstream: BindingTestUpstream | null;
  classification: BindingTestClassification | null;
  /**
   * Panel two: the document the response mapping produced. Genuinely open —
   * its shape is whatever the tool's `outputSchema` describes.
   */
  mapped: unknown;
  verification: BindingTestVerification | null;
  ranAt: string;
}
