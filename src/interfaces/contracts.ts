/**
 * Standard tool contracts and their versions (design spec §7.5, T3). The wire
 * shapes of assay-backend `tool-contract-version.dto.ts` and
 * `operator-contracts.dto.ts`; the screens read them through
 * `features/contracts`, which says every internal word in plain English.
 */

export type VersionBump = "PATCH" | "MINOR" | "MAJOR";

export type ToolVersionStatus = "DRAFT" | "ACTIVE" | "DEPRECATED" | "RETIRED";

export type ToolContractTier = "UNVERIFIED" | "VERIFIED" | "GUARANTEED";

export type ContractChangeKind =
  | "DOCS_CHANGED"
  | "FIELD_ADDED_OPTIONAL"
  | "FIELD_ADDED_CORE"
  | "FIELD_REMOVED"
  | "FIELD_PROMOTED"
  | "FIELD_DEMOTED"
  | "FIELD_REQUIRED_CHANGED"
  | "TYPE_CHANGED"
  | "SCHEMA_CHANGED"
  | "POLICY_CHANGED";

/** A JSON Schema as the contract carries it: an object schema with top-level properties. */
export interface ContractSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [keyword: string]: unknown;
}

/** One worked example of a call (`ToolExampleDto`). */
export interface ToolExample {
  title?: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/** One published version of a tool's contract (`ToolContractVersionDto`). */
export interface ToolContractVersion {
  /** Sequence number within the tool; what `toolVersion` and `version` bodies name. */
  version: number;
  semver: string;
  major: number;
  status: ToolVersionStatus;
  summary: string;
  description: string;
  inputSchema: ContractSchema;
  outputSchema: ContractSchema;
  optionalInputFields: string[];
  optionalOutputFields: string[];
  examples: ToolExample[];
  tier: ToolContractTier;
  /** DEPRECATED and RETIRED only. */
  sunsetAt: string | null;
  changelog: string | null;
  publishedAt: string | null;
  /** Unpinned URLs serve this version. */
  isCurrent: boolean;
}

/** One published version on a catalogue card (`ToolVersionBriefDto`): no schemas. */
export interface ToolVersionBrief {
  version: number;
  semver: string;
  major: number;
  status: ToolVersionStatus;
  sunsetAt: string | null;
  changelog: string | null;
  publishedAt: string | null;
  isCurrent: boolean;
}

/** `GET /catalogue/tools/:toolId/versions` and its public twin (`ToolVersionListDto`). */
export interface ToolVersionList {
  toolId: string;
  name: string;
  /** The semver unpinned URLs serve, e.g. "2.0.0". */
  currentVersion: string | null;
  /** Newest first. */
  versions: ToolContractVersion[];
}

/** The contract-version half of a catalogue tool card (T3). Optional: an older backend omits it. */
export interface CatalogueToolVersionFields {
  /** The current version's one-line summary (at most 200 characters). */
  summary?: string;
  /** The current semver, e.g. "2.0.0"; null on a tool with no published version. */
  version?: string | null;
  /** Newest first. */
  versions?: ToolVersionBrief[];
  /** Majors still serving until their sunset. */
  deprecatedMajors?: number[];
}

/** `_meta["assay/deprecated"]` on an MCP tool. */
export interface ToolDeprecation {
  sunsetAt: string;
  replacement: string | null;
}

/* ---------------------------------------------------------- operator editor */

/** One line of the schema diff (`ContractChangeDto`). */
export interface ContractChange {
  kind: ContractChangeKind;
  side: "input" | "output" | null;
  field: string | null;
  bump: VersionBump;
  /** The backend's own short sentence, e.g. "optional output field uv_index added". */
  detail: string;
}

/** The single DRAFT version of a tool, with its diff (`ContractDraftDto`). */
export interface ContractDraft {
  version: number;
  /** null on a first version. */
  baseSemver: string | null;
  baseVersion: number | null;
  /** What publishing it now would make it. */
  nextSemver: string;
  /** null: identical to its base. */
  bump: VersionBump | null;
  changes: ContractChange[];
  /** Empty when it can be published. */
  problems: string[];
  summary: string;
  description: string;
  inputSchema: ContractSchema;
  outputSchema: ContractSchema;
  optionalInputFields: string[];
  optionalOutputFields: string[];
  examples: ToolExample[];
  verificationPolicyId: string | null;
  tier: ToolContractTier | null;
  changelog: string | null;
  updatedAt: string;
}

/** Per major: its newest version and how many bindings serve it (`ContractMajorDto`). */
export interface ContractMajor {
  major: number;
  latestSemver: string;
  status: ToolVersionStatus;
  sunsetAt: string | null;
  /** Bindings routing would accept for this major now, under no buyer rules. */
  eligibleBindings: number;
  /** ACTIVE bindings whose published range covers this major. */
  activeBindings: number;
}

export type OperatorToolStatus = "DRAFT" | "ACTIVE" | "DEPRECATED" | "RETIRED" | "REMOVED";

export interface OperatorToolSummary {
  id: string;
  name: string;
  kind: "STANDARD" | "PROVIDER";
  category: string;
  tags: string[];
  status: OperatorToolStatus;
  currentSemver: string | null;
  currentVersion: number | null;
  /** A DRAFT version exists. */
  hasDraft: boolean;
}

export interface OperatorToolList {
  tools: OperatorToolSummary[];
}

/** `GET /operator/tools/:id` (`OperatorToolDto`). */
export interface OperatorTool extends OperatorToolSummary {
  replacementToolId: string | null;
  /** Published versions, newest first. */
  versions: ToolContractVersion[];
  draft: ContractDraft | null;
  majors: ContractMajor[];
  /** The version (sequence number) the editor suggests making current, or null. */
  suggestedCurrentVersion: number | null;
}

export interface CreateStandardToolBody {
  name: string;
  category: string;
  tags?: string[];
}

export interface SaveContractDraftBody {
  summary: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  optionalInputFields?: string[];
  optionalOutputFields?: string[];
  examples?: Record<string, unknown>[];
  verificationPolicyId?: string;
  tier?: ToolContractTier;
  changelog?: string;
  baseVersion?: number;
}

/** What every action that reaches traffic carries into the override register. */
export interface ContractActionBody {
  reasonCode: string;
  /** At least 20 characters. */
  note: string;
  ticketRef?: string;
}

export interface MoveCurrentVersionBody extends ContractActionBody {
  version: number;
}

export interface DeprecateVersionBody extends ContractActionBody {
  /** ISO 8601, UTC; at least 90 days from now. */
  sunsetAt: string;
  replacementToolId?: string;
}
