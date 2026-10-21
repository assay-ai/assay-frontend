import { contractProblems, diffContracts, schemaFields, type ContractShape } from "@/features/contracts/diff";
import { bumpSemver, compareSemverText } from "@/features/contracts/semver";
import { problemText, STATUS_LABEL, sunsetDay } from "@/features/contracts/text";
import type {
  ContractChange,
  ContractMajor,
  ContractSchema,
  OperatorTool,
  OperatorToolSummary,
  SaveContractDraftBody,
  ToolContractVersion,
  VersionBump,
} from "@/interfaces/contracts";
import type { OperatorApproval, OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import { operatorErrorSentence } from "./operator-errors";

/**
 * The operator contract editor's rules (design spec §7.5 "Editor"), kept out
 * of the pages so they can be tested. Pure.
 *
 * The form holds the schemas and examples as JSON text, because operators
 * paste and edit JSON Schema; everything else is a plain field. The live
 * preview diffs the form against the version it changes, exactly as the
 * server will on save, so the bump is visible while someone types.
 */

/* ------------------------------------------------------------------- roles */

/** Who drafts and publishes contracts (`P-10`, `P-11`, `P-12`): Policy author or Policy approver. */
export const CONTRACT_ROLES: readonly OperatorRole[] = ["POL", "POLA"];
/** Who answers tool requests (`PATCH /operator/tool-requests/:id`). */
export const TOOL_REQUEST_ROLES: readonly OperatorRole[] = ["SUP", "BD", "ADJL"];

export function mayEditContracts(roles: readonly OperatorRole[]): boolean {
  return roles.some((role) => CONTRACT_ROLES.includes(role));
}

export function mayAnswerToolRequests(roles: readonly OperatorRole[]): boolean {
  return roles.some((role) => TOOL_REQUEST_ROLES.includes(role));
}

/* -------------------------------------------------------------------- form */

export interface ContractForm {
  summary: string;
  description: string;
  inputSchema: string;
  outputSchema: string;
  optionalInputFields: string[];
  optionalOutputFields: string[];
  examples: string;
  changelog: string;
  /** The published version (sequence number) this draft changes; null = the newest. */
  baseVersion: number | null;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

/** A first version's starting point: one input and one output to rename, so the shape is never a blank page. */
export const STARTER_INPUT: ContractSchema = {
  type: "object",
  properties: { query: { type: "string", description: "What to look up. Rename or replace this field." } },
  required: ["query"],
};
export const STARTER_OUTPUT: ContractSchema = {
  type: "object",
  properties: { result: { type: "string", description: "The answer. Rename or replace this field." } },
  required: ["result"],
};

/** The newest published version, by semver. */
export function newestVersion(versions: readonly ToolContractVersion[]): ToolContractVersion | null {
  return [...versions].sort((a, b) => compareSemverText(b.semver, a.semver))[0] ?? null;
}

/**
 * The form a tool opens with: its draft; else a new draft that starts from
 * the newest published version; else an empty first version.
 */
export function formFor(
  tool: Pick<OperatorTool, "draft" | "versions">,
  /** A first version's text, from the tool request it came from. */
  seed: { summary: string; description: string } | null = null,
): ContractForm {
  const draft = tool.draft;
  if (draft) {
    return {
      summary: draft.summary,
      description: draft.description,
      inputSchema: json(draft.inputSchema),
      outputSchema: json(draft.outputSchema),
      optionalInputFields: [...draft.optionalInputFields],
      optionalOutputFields: [...draft.optionalOutputFields],
      examples: json(draft.examples ?? []),
      changelog: draft.changelog ?? "",
      baseVersion: draft.baseVersion,
    };
  }
  const base = newestVersion(tool.versions);
  if (base) {
    return {
      summary: base.summary,
      description: base.description,
      inputSchema: json(base.inputSchema),
      outputSchema: json(base.outputSchema),
      optionalInputFields: [...base.optionalInputFields],
      optionalOutputFields: [...base.optionalOutputFields],
      examples: json(base.examples ?? []),
      changelog: "",
      baseVersion: base.version,
    };
  }
  return {
    summary: seed?.summary.slice(0, 200) ?? "",
    description: seed?.description ?? "",
    inputSchema: json(STARTER_INPUT),
    outputSchema: json(STARTER_OUTPUT),
    optionalInputFields: [],
    optionalOutputFields: [],
    examples: "[]",
    changelog: "",
    baseVersion: null,
  };
}

export interface ParsedForm {
  /** The body to save, when every JSON field parses. */
  body: SaveContractDraftBody | null;
  /** Per field, why its JSON does not parse. */
  jsonErrors: Partial<Record<"inputSchema" | "outputSchema" | "examples", string>>;
  shape: ContractShape | null;
}

function parseJson(text: string, label: string): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/^JSON\.parse: /, "") : "";
    return { value: null, error: `${label} is not valid JSON${detail ? `: ${detail}` : "."}` };
  }
}

/** The form's JSON fields parsed, and the body `POST …/versions` takes. Optional fields no longer in the schema are dropped. */
export function parseForm(form: ContractForm): ParsedForm {
  const input = parseJson(form.inputSchema, "The input schema");
  const output = parseJson(form.outputSchema, "The output schema");
  const examples = parseJson(form.examples.trim() === "" ? "[]" : form.examples, "The examples");
  const jsonErrors: ParsedForm["jsonErrors"] = {};
  if (input.error) jsonErrors.inputSchema = input.error;
  else if (!isObject(input.value)) jsonErrors.inputSchema = "The input schema must be a JSON object.";
  if (output.error) jsonErrors.outputSchema = output.error;
  else if (!isObject(output.value)) jsonErrors.outputSchema = "The output schema must be a JSON object.";
  if (examples.error) jsonErrors.examples = examples.error;
  else if (!Array.isArray(examples.value)) jsonErrors.examples = "The examples must be a JSON list: [ … ].";
  if (Object.keys(jsonErrors).length > 0) return { body: null, jsonErrors, shape: null };

  const inputSchema = input.value as ContractSchema;
  const outputSchema = output.value as ContractSchema;
  const inputs = schemaFields(inputSchema);
  const outputs = schemaFields(outputSchema);
  const optionalInputFields = form.optionalInputFields.filter((f) => inputs.includes(f));
  const optionalOutputFields = form.optionalOutputFields.filter((f) => outputs.includes(f));
  const body: SaveContractDraftBody = {
    summary: form.summary.trim(),
    description: form.description.trim(),
    inputSchema: inputSchema as Record<string, unknown>,
    outputSchema: outputSchema as Record<string, unknown>,
    optionalInputFields,
    optionalOutputFields,
    examples: examples.value as Record<string, unknown>[],
    ...(form.changelog.trim() ? { changelog: form.changelog.trim() } : {}),
    ...(form.baseVersion !== null ? { baseVersion: form.baseVersion } : {}),
  };
  return {
    body,
    jsonErrors,
    shape: {
      summary: body.summary,
      description: body.description,
      inputSchema,
      outputSchema,
      optionalInputFields,
      optionalOutputFields,
      examples: body.examples ?? [],
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shapeOfVersion(version: ToolContractVersion): ContractShape {
  return {
    summary: version.summary,
    description: version.description,
    inputSchema: version.inputSchema,
    outputSchema: version.outputSchema,
    optionalInputFields: version.optionalInputFields,
    optionalOutputFields: version.optionalOutputFields,
    examples: version.examples,
  };
}

export interface LivePreview {
  /** The version it changes, or null for a first version. */
  baseSemver: string | null;
  bump: VersionBump | null;
  nextSemver: string;
  changes: readonly ContractChange[];
  /** In plain words; empty when it can be saved and published. */
  problems: string[];
  firstVersion: boolean;
}

/**
 * The diff of the form against its base, while someone types. Policy and tier
 * are not edited here, so they never differ.
 */
export function livePreview(form: ContractForm, versions: readonly ToolContractVersion[]): LivePreview {
  const base = (form.baseVersion !== null ? versions.find((v) => v.version === form.baseVersion) : null) ?? newestVersion(versions);
  const parsed = parseForm(form);
  if (!parsed.shape) {
    return {
      baseSemver: base?.semver ?? null,
      bump: null,
      nextSemver: base ? base.semver : "1.0.0",
      changes: [],
      problems: Object.values(parsed.jsonErrors),
      firstVersion: base === null,
    };
  }
  const diff = diffContracts(base ? shapeOfVersion(base) : null, parsed.shape);
  const problems = contractProblems(parsed.shape).map(problemText);
  if (base && !diff.bump) problems.push(problemText(`identical to v${base.semver}`));
  return {
    baseSemver: base?.semver ?? null,
    bump: base ? diff.bump : "MAJOR",
    nextSemver: base ? bumpSemver(base.semver, diff.bump) : "1.0.0",
    changes: diff.changes,
    problems,
    firstVersion: base === null,
  };
}

/** Whether the form differs from what is saved (the draft, or nothing). */
export function isDirty(form: ContractForm, tool: Pick<OperatorTool, "draft" | "versions">): boolean {
  if (!tool.draft) {
    const start = formFor({ draft: null, versions: tool.versions });
    return !sameForm(form, start);
  }
  return !sameForm(form, formFor(tool));
}

function sameForm(a: ContractForm, b: ContractForm): boolean {
  const norm = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return text;
    }
  };
  return (
    a.summary.trim() === b.summary.trim() &&
    a.description.trim() === b.description.trim() &&
    norm(a.inputSchema) === norm(b.inputSchema) &&
    norm(a.outputSchema) === norm(b.outputSchema) &&
    norm(a.examples) === norm(b.examples) &&
    a.changelog.trim() === b.changelog.trim() &&
    [...a.optionalInputFields].sort().join() === [...b.optionalInputFields].sort().join() &&
    [...a.optionalOutputFields].sort().join() === [...b.optionalOutputFields].sort().join() &&
    (a.baseVersion ?? null) === (b.baseVersion ?? null)
  );
}

/* ------------------------------------------------------------------ majors */

export interface MajorRow {
  major: number;
  /** "v2". */
  label: string;
  latestSemver: string;
  status: ContractMajor["status"];
  statusText: string;
  isCurrent: boolean;
  eligible: number;
  active: number;
  /** "2 providers can serve it now", "No provider can serve it yet". */
  readyText: string;
  /** The newest ACTIVE version of this major (what "Make current" moves to), when it is not current. */
  makeCurrentVersion: ToolContractVersion | null;
  /** The version a deprecation names (any ACTIVE one of the major), when allowed. */
  deprecateVersion: ToolContractVersion | null;
  /** Why it can't be deprecated, in words, or null. */
  deprecateBlocked: string | null;
  sunsetText: string | null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One row per major, newest first, with what an operator can do to it. */
export function majorRows(tool: Pick<OperatorTool, "majors" | "versions" | "currentVersion">): MajorRow[] {
  const current = tool.versions.find((v) => v.version === tool.currentVersion) ?? null;
  return [...tool.majors]
    .sort((a, b) => b.major - a.major)
    .map((m) => {
      const ofMajor = tool.versions.filter((v) => v.major === m.major);
      const newestActive = newestVersion(ofMajor.filter((v) => v.status === "ACTIVE"));
      const isCurrent = current?.major === m.major;
      const readyText =
        m.status === "RETIRED"
          ? "Retired: serves no calls"
          : m.eligibleBindings === 0
            ? "No provider can serve it yet"
            : `${plural(m.eligibleBindings, "provider", "providers")} can serve it now`;
      return {
        major: m.major,
        label: `v${m.major}`,
        latestSemver: m.latestSemver,
        status: m.status,
        statusText: STATUS_LABEL[m.status] ?? m.status,
        isCurrent,
        eligible: m.eligibleBindings,
        active: m.activeBindings,
        readyText,
        makeCurrentVersion: !isCurrent && newestActive && newestActive.version !== tool.currentVersion ? newestActive : null,
        // Any major agents don't get by default can be deprecated; the default moves first.
        deprecateVersion: !isCurrent && newestActive ? newestActive : null,
        deprecateBlocked:
          m.status !== "ACTIVE" || !isCurrent
            ? null
            : tool.versions.some((v) => v.major !== m.major && v.status === "ACTIVE")
              ? `v${m.major} is the version agents get by default, so it can't be deprecated. Make another version the default first.`
              : `v${m.major} is the version agents get by default, so it can't be deprecated. Publish a newer version and make it the default first.`,
        sunsetText: m.sunsetAt ? `${m.status === "RETIRED" ? "Stopped" : "Stops"} on ${sunsetDay(m.sunsetAt)} (UTC)` : null,
      };
    });
}

/** The suggestion to move the current version (§7.3), in words, or null. */
export function suggestion(tool: Pick<OperatorTool, "suggestedCurrentVersion" | "versions" | "majors" | "currentVersion">): {
  version: ToolContractVersion;
  text: string;
} | null {
  if (tool.suggestedCurrentVersion === null || tool.suggestedCurrentVersion === tool.currentVersion) return null;
  const version = tool.versions.find((v) => v.version === tool.suggestedCurrentVersion);
  if (!version) return null;
  const eligible = tool.majors.find((m) => m.major === version.major)?.eligibleBindings ?? 0;
  return {
    version,
    text: `v${version.semver} is ready: ${plural(eligible, "provider", "providers")} can serve it. Make it the version agents get by default?`,
  };
}

/* --------------------------------------------------------------- approvals */

export const PUBLISH_ACTION = "tool_version.publish";
export const CURRENT_ACTION = "tool.current_version";

export interface PendingToolActions {
  publish: OperatorApproval | null;
  current: OperatorApproval | null;
}

/** The two-person requests already waiting for this tool, so a second identical one is not sent. */
export function pendingFor(toolId: string, approvals: readonly OperatorApproval[]): PendingToolActions {
  const mine = approvals.filter((a) => a.status === "PENDING" && a.target === `tool:${toolId}`);
  return {
    publish: mine.find((a) => a.action === PUBLISH_ACTION) ?? null,
    current: mine.find((a) => a.action === CURRENT_ACTION) ?? null,
  };
}

/** The version a pending "Make current" moves to (its payload's body). */
export function pendingCurrentVersion(approval: OperatorApproval | null): number | null {
  const body = (approval?.payload?.body ?? {}) as Record<string, unknown>;
  return typeof body.version === "number" ? body.version : null;
}

/* ------------------------------------------------------------------ list */

/**
 * "v2.0.0", or "Draft, never published" for a tool no version was ever
 * published of (a new draft, or a row seeded without one, `unseeded_…`).
 */
export function toolStatusText(tool: Pick<OperatorToolSummary, "status" | "currentSemver" | "hasDraft">): string {
  if (tool.status === "REMOVED") return "Removed";
  if (tool.status === "DRAFT" || !tool.currentSemver) return "Draft, never published";
  return `v${tool.currentSemver}`;
}

/** Tools agents can get first, never-published drafts after them; each group keeps its order. */
export function publishedFirst<T extends Pick<OperatorToolSummary, "status" | "currentSemver" | "hasDraft">>(tools: readonly T[]): T[] {
  const never = (tool: T) => toolStatusText(tool) === "Draft, never published";
  return [...tools.filter((t) => !never(t)), ...tools.filter(never)];
}

/* ------------------------------------------------------------------ names */

const NAME_RE = /^[a-z][a-z0-9_]{1,47}$/;
const CATEGORY_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** "Tide times at a beach!" → "tide_times_at_a_beach" (≤ 48, starts with a letter). */
export function toolNameFrom(title: string): string {
  const name = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_")
    .slice(0, 48)
    .replace(/_+$/g, "");
  const lettered = /^[a-z]/.test(name) ? name : `tool_${name}`.slice(0, 48);
  return lettered.length >= 2 ? lettered : "new_tool";
}

const STOP_WORDS = new Set(["a", "an", "the", "for", "of", "to", "in", "on", "by", "with", "and", "or", "from", "at"]);

/** A short name to suggest: the first three words that carry meaning, "Air quality index for a city" → "air_quality_index". */
export function suggestToolName(title: string): string {
  const words = toolNameFrom(title).split("_").filter((w) => w && !STOP_WORDS.has(w));
  return toolNameFrom(words.slice(0, 3).join(" ") || title);
}

export function toolNameProblem(name: string): string | null {
  if (!NAME_RE.test(name)) return "Use 2–48 lower-case letters, digits or _, starting with a letter (like get_weather).";
  if (name.includes("__")) return "Don't use two _ in a row.";
  return null;
}

/**
 * The name check of "Make a standard tool" (/operator/tools/promotions): the
 * same rule as the accept sheet, so `tide__x` is refused before the API
 * refuses it (BUG-OPS-MARKET-03). Empty is not a problem yet.
 */
export function standardToolNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || toolNameProblem(trimmed) === null) return null;
  return "snake_case, starting with a letter, no “__”, at most 48 characters.";
}

export function categoryProblem(category: string): string | null {
  return CATEGORY_RE.test(category) ? null : "Use lower-case letters, digits or -, starting with a letter (like weather).";
}

/* ------------------------------------------------------------------ errors */

/** A refusal of an editor action in plain words. */
export function contractErrorMessage(error: unknown): { text: string; problems: string[] } {
  if (error instanceof ApiError) {
    const context = (error.context ?? {}) as Record<string, unknown>;
    const problems = Array.isArray(context.problems) ? (context.problems as unknown[]).filter((p): p is string => typeof p === "string").map(problemText) : [];
    switch (error.code) {
      case "TOOL_CONTRACT_INVALID":
        return { text: "The server didn't accept the draft. Fix these first:", problems };
      case "TOOL_CONTRACT_NAME_TAKEN":
        return {
          text: `That name is taken.${typeof context.suggestion === "string" ? ` "${context.suggestion}" is free.` : ""}`,
          problems: [],
        };
      case "TOOL_CONTRACT_NO_CHANGES":
        return { text: `Nothing changed from v${String(context.base ?? "?")}. Edit something first.`, problems: [] };
      case "TOOL_CONTRACT_STATE":
        return { text: typeof context.reason === "string" ? problemText(context.reason) : "The tool changed in the meantime. Reload it and try again.", problems: [] };
      case "TOOL_VERSION_NOT_FOUND":
        return { text: "That version no longer exists. Reload the tool.", problems: [] };
      case "TOOL_NOT_FOUND":
        return { text: "This tool no longer exists.", problems: [] };
      default:
        break;
    }
  }
  return { text: operatorErrorSentence(error), problems: [] };
}
