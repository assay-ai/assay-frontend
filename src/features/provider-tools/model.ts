import { problemText } from "@/features/contracts/text";
import { formFor, parseForm, type ContractForm } from "@/features/operator/contract-editor";
import type { OperatorTool } from "@/interfaces/contracts";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import type {
  CreateProviderToolBody,
  GateRequirement,
  ProviderTool,
  ProviderToolContractBody,
  ProviderToolGate,
  ProviderToolReview,
  ProviderToolSummary,
  ProviderToolVersion,
  ProviderToolVisibility,
  ScreenFinding,
} from "@/services/provider-tools.service";

/**
 * "Publish your own API" (design spec §7.6, §7.10), the rules the screens
 * show, kept out of the pages so they can be tested. Pure.
 *
 * A provider tool is `{handle}__{tool}`. It is created PRIVATE ("Only my
 * team") with a draft 1.0.0; the publish gate (a passing test of the
 * endpoint, stake, payout, and the schema screen) is needed for "Anyone with
 * the link" (UNLISTED, badge "Not reviewed") and for review, which lists it
 * in the catalogue.
 */

/* ------------------------------------------------------------------ names */

/** `{tool}`: lowercase, digits and `_`, starting with a letter, 2–40 characters. */
export const LOCAL_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const LOCAL_NAME_MAX = 40;
/** `{handle}__{tool}`, hard cap enforced on save. */
export const FULL_NAME_MAX = 48;
/** What most clients allow a model to see: `mcp__{server}__{name}`. */
export const MODEL_NAME_MAX = 64;
/** The Connect sheet suggests server names of at most 9 characters (§7.11). */
export const SERVER_NAME_MAX = 9;

export function fullToolName(handle: string, localName: string): string {
  return `${handle}__${localName}`;
}

/** The name as a model sees it behind the client prefix, with the suggested server name (the handle, cut to 9). */
export function modelSeenName(handle: string, localName: string): string {
  return `mcp__${handle.slice(0, SERVER_NAME_MAX)}__${fullToolName(handle, localName)}`;
}

/** Why `{tool}` cannot be saved, in plain words; null when it can. */
export function localNameProblem(handle: string | null, raw: string): string | null {
  const name = raw.trim();
  if (name === "") return "Give your tool a name.";
  if (name.includes("__")) return "Don't use two underscores in a row: “__” separates your public name from the tool.";
  if (/[A-Z]/.test(name)) return "Use lowercase letters only.";
  if (!/^[a-z]/.test(name)) return "Start with a letter.";
  if (name.length < 2) return "Use at least 2 characters.";
  if (name.length > LOCAL_NAME_MAX) return `Use at most ${LOCAL_NAME_MAX} characters.`;
  if (!LOCAL_NAME_RE.test(name)) return "Use lowercase letters, digits and “_” only.";
  if (handle && fullToolName(handle, name).length > FULL_NAME_MAX) {
    return `The full name ${fullToolName(handle, name)} is ${fullToolName(handle, name).length} characters; the most is ${FULL_NAME_MAX}. Shorten the tool name.`;
  }
  return null;
}

/** A warning before the hard cap: "4 characters left before the limit". Null while there is room. */
export function nameLengthWarning(handle: string, localName: string): string | null {
  const left = FULL_NAME_MAX - fullToolName(handle, localName).length;
  if (left < 0 || left > 6) return null;
  return left === 0 ? "This is the longest name allowed." : `${left} character${left === 1 ? "" : "s"} left before the limit.`;
}

/** A tag as search reads it: lowercase, digits and "-", at most 32 characters. */
export const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const TAGS_MAX = 10;

/** "posts, Social" → ["posts", "social"]; with what is wrong, if anything. */
export function parseTags(text: string): { tags: string[]; problem: string | null } {
  const tags = [...new Set(text.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > TAGS_MAX) return { tags, problem: `At most ${TAGS_MAX} tags.` };
  const bad = tags.find((t) => !TAG_RE.test(t));
  if (bad) return { tags, problem: `“${bad}”: use lowercase letters, digits and “-”, at most 32 characters.` };
  return { tags, problem: null };
}

/** A free-text title as a tool name: "Search posts!" → "search_posts". */
export function suggestLocalName(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "");
  return base.slice(0, LOCAL_NAME_MAX).replace(/_+$/, "");
}

/* ----------------------------------------------------------------- states */

export type ProviderToolStateId =
  | "TAKEN_DOWN"
  | "RETIRED"
  | "DEPRECATED"
  | "IN_REVIEW"
  | "CHANGES_IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "LISTED"
  | "UNLISTED"
  | "PRIVATE"
  | "DRAFT";

export type StateTone = "neutral" | "primary" | "success" | "warning" | "danger";

export interface ProviderToolStateView {
  id: ProviderToolStateId;
  label: string;
  tone: StateTone;
  /** One sentence: what it means and what happens next. */
  detail: string;
}

/** The plain labels for who can use it (design spec §6.3). */
export const VISIBILITY_LABEL: Readonly<Record<ProviderToolVisibility, string>> = {
  PRIVATE: "Only my team",
  UNLISTED: "Anyone with the link",
  LISTED: "Listed in the catalogue",
};

export function visibilityLabel(visibility: string): string {
  return VISIBILITY_LABEL[visibility as ProviderToolVisibility] ?? visibility;
}

/**
 * The one state a tool shows in the list and on its page. A takedown wins,
 * then the tool's lifecycle, then its review, then who can use it.
 */
export function providerToolState(tool: Pick<ProviderToolSummary, "status" | "visibility" | "review" | "removedAt" | "currentVersion" | "replacementName">): ProviderToolStateView {
  if (tool.removedAt || tool.status === "REMOVED") {
    return {
      id: "TAKEN_DOWN",
      label: "Taken down",
      tone: "danger",
      detail: "Assay removed it from every view. Calls to it get an error. Contact support if you think this is a mistake.",
    };
  }
  if (tool.status === "RETIRED") {
    return { id: "RETIRED", label: "Retired", tone: "neutral", detail: "It no longer answers calls." };
  }
  if (tool.status === "DEPRECATED") {
    return {
      id: "DEPRECATED",
      label: "Deprecated",
      tone: "warning",
      detail: tool.replacementName ? `Agents are pointed to ${tool.replacementName}.` : "It still answers calls until its sunset date.",
    };
  }
  const review = tool.review;
  switch (review.state) {
    case "IN_REVIEW":
      return { id: "IN_REVIEW", label: "In review", tone: "primary", detail: "Assay is checking it before it is listed in the catalogue. You can withdraw the review to edit it." };
    case "CHANGES_IN_REVIEW":
      return { id: "CHANGES_IN_REVIEW", label: "Changes in review", tone: "primary", detail: `${review.label}.` };
    case "REJECTED":
    case "CHANGES_REJECTED":
      return {
        id: "CHANGES_REQUESTED",
        label: "Changes requested",
        tone: "warning",
        detail: review.state === "CHANGES_REJECTED" && review.approvedSemver ? `v${review.approvedSemver} is still listed. Fix what the reviewer asked and resubmit.` : "Fix what the reviewer asked and resubmit.",
      };
    default:
      break;
  }
  if (tool.visibility === "LISTED" || review.state === "LISTED") {
    return { id: "LISTED", label: "Listed", tone: "success", detail: "Reviewed, and listed in the catalogue and on your public page." };
  }
  if (tool.status === "DRAFT" || tool.currentVersion === null) {
    return { id: "DRAFT", label: "Draft", tone: "neutral", detail: "Not published yet. Only your team can see it." };
  }
  if (tool.visibility === "UNLISTED") {
    return { id: "UNLISTED", label: VISIBILITY_LABEL.UNLISTED, tone: "primary", detail: "Reachable through your own link-only tool sets. It shows “Not reviewed” until Assay reviews it." };
  }
  return { id: "PRIVATE", label: VISIBILITY_LABEL.PRIVATE, tone: "neutral", detail: "Your own agents can call it through your private tool sets." };
}

/** Whether the "Not reviewed" badge is shown: reachable by others, never approved. */
export function showsNotReviewed(tool: Pick<ProviderToolSummary, "notReviewed" | "visibility" | "removedAt" | "status"> & { review?: Pick<ProviderToolReview, "state"> }): boolean {
  // In review or sent back, the state chip already says where the review stands.
  const reviewing = tool.review ? ["IN_REVIEW", "CHANGES_IN_REVIEW", "REJECTED", "CHANGES_REJECTED"].includes(tool.review.state) : false;
  return tool.notReviewed && tool.visibility !== "PRIVATE" && !tool.removedAt && tool.status !== "REMOVED" && !reviewing;
}

/* ------------------------------------------------------------ the 4 steps */

export type PublishStepId = "name" | "contract" | "connect" | "share";

export const PUBLISH_STEPS: readonly { id: PublishStepId; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "contract", label: "Inputs & outputs" },
  { id: "connect", label: "Connect & check" },
  { id: "share", label: "Who can use it" },
];

export function isPublishStep(value: string | null | undefined): value is PublishStepId {
  return PUBLISH_STEPS.some((step) => step.id === value);
}

/** Which steps are done, from the tool and its gate. */
export function doneSteps(tool: ProviderTool | null, gate: ProviderToolGate | null): Set<PublishStepId> {
  const done = new Set<PublishStepId>();
  if (!tool) return done;
  done.add("name");
  if (tool.currentVersion !== null) done.add("contract");
  if (gate?.passed) done.add("connect");
  const sentBack = tool.review.status === "REJECTED";
  if (!sentBack && (tool.visibility !== "PRIVATE" || tool.review.status === "PENDING" || tool.review.status === "APPROVED")) done.add("share");
  return done;
}

/** Where to resume a tool: the first step that is not done; a review sent back opens where the fix is. */
export function resumeStep(tool: ProviderTool | null, gate: ProviderToolGate | null): PublishStepId {
  if (tool?.review.status === "REJECTED") return "contract";
  const done = doneSteps(tool, gate);
  return PUBLISH_STEPS.find((step) => !done.has(step.id))?.id ?? "share";
}

/* ------------------------------------------------------- the publish gate */

export type GateFix =
  | { kind: "link"; label: string; href: string }
  | { kind: "step"; label: string; step: PublishStepId };

export interface GateRow {
  requirement: string;
  met: boolean;
  /** What it checks: "Your endpoint passed a test". */
  label: string;
  /** What to do when it is not met, in one sentence. */
  todo: string;
  /** The server's own detail, when it sent one. */
  detail: string | null;
  fix: GateFix | null;
}

/** The wizard that connects and tests the endpoint of this provider tool, and returns here after. */
export function connectHref(tool: Pick<ProviderTool, "id" | "binding">, stage: "connect" | "live" = "connect"): string {
  const back = `back=${encodeURIComponent(routes.providerApi(tool.id, "connect"))}`;
  if (tool.binding) return `${routes.bindingWizard(tool.binding.bindingId, stage)}&${back}`;
  return `${routes.bindingWizard(undefined, "connect")}&tool=${encodeURIComponent(tool.id)}&${back}`;
}

export function gateRows(gate: ProviderToolGate, tool: Pick<ProviderTool, "id" | "binding">): GateRow[] {
  const ran = gate.requirements.find((r) => r.requirement === "TESTER_RUN")?.met ?? true;
  return gate.requirements.map((row) => gateRow(row, tool, ran));
}

function gateRow(row: GateRequirement, tool: Pick<ProviderTool, "id" | "binding">, ran = true): GateRow {
  const base = { requirement: row.requirement, met: row.met, detail: row.detail };
  switch (row.requirement) {
    case "PROVIDER_ACTIVE":
      return { ...base, label: "Your provider account is active", todo: "Finish setting up your provider account.", fix: { kind: "link", label: "Finish setup", href: "/provider/setup" } };
    case "HANDLE_ACTIVE":
      return { ...base, label: "You have a public name", todo: "Claim a public name, like @acme.", fix: { kind: "step", label: "Claim a public name", step: "name" } };
    case "PUBLISHED_VERSION":
      return { ...base, label: "A version is published", todo: "Publish the inputs and outputs you wrote.", fix: { kind: "step", label: "Publish the draft", step: "contract" } };
    case "BINDING_PUBLISHED":
      return { ...base, label: "Your endpoint is connected and live", todo: "Connect your endpoint, set a price and publish the listing.", fix: { kind: "link", label: tool.binding ? "Finish the listing" : "Connect your endpoint", href: connectHref(tool, tool.binding ? "live" : "connect") } };
    case "TESTER_RUN":
      return { ...base, label: "Your endpoint was tested", todo: "Run a test of your endpoint.", fix: { kind: "link", label: "Run a test", href: connectHref(tool) } };
    case "TESTER_PASSED":
      // Before any test ran there is nothing to repeat: the same fix as "was tested", once.
      return ran
        ? { ...base, label: "The test passed", todo: "Get a passing test of your current connection.", fix: { kind: "link", label: "Test again", href: connectHref(tool) } }
        : { ...base, label: "The test passed", todo: "Comes with the first test above.", fix: null };
    case "PAYOUT_ACCOUNT":
      return { ...base, label: "A payout wallet is set", todo: "Add a payout wallet so you can be paid.", fix: { kind: "link", label: "Add a payout wallet", href: "/provider/setup?step=wallet" } };
    case "STAKE_AT_MINIMUM_ON_EVERY_CHAIN":
      return { ...base, label: "Your stake is at the minimum", todo: "Add stake on every chain you are paid on.", fix: { kind: "link", label: "Add stake", href: routes.stake("stake") } };
    case "SCHEMA_SCREEN":
      return { ...base, label: "The text passes the safety screen", todo: "Fix the findings listed below, then publish again.", fix: { kind: "step", label: "Edit inputs & outputs", step: "contract" } };
    case "EXAMPLES_MATCH_SCHEMA":
      return { ...base, label: "The examples match the schemas", todo: "Fix the examples so they match the input and output schemas.", fix: { kind: "step", label: "Edit the examples", step: "contract" } };
    default:
      return { ...base, label: row.requirement, todo: row.detail ?? "Not met yet.", fix: null };
  }
}

/* ------------------------------------------------------ the schema screen */

const FINDING_TEXT: Readonly<Record<string, string>> = {
  CONTRACT_INVALID: "The schema is not valid JSON Schema.",
  TEXT_TOO_LONG: "This text is too long.",
  INSTRUCTION_PATTERN: "This reads like an instruction to a model. Describe what the tool does instead.",
  HIDDEN_CHARACTERS: "This contains hidden or control characters. Retype it as plain text.",
  SECRET_INPUT: "This asks the agent for a secret (a key, password or token). Keep secrets in your endpoint's authentication.",
  REMOTE_REF: "This points to a schema elsewhere ($ref). Write the schema out in full.",
  SCHEMA_TOO_COMPLEX: "The schema is too deep or too large.",
  EXAMPLE_MISMATCH: "This example does not match the schemas.",
  RULES_INVALID: "This check on answers cannot be read.",
};

export function findingText(finding: Pick<ScreenFinding, "code">): string {
  return FINDING_TEXT[finding.code] ?? "This does not pass the safety screen.";
}

/** `inputSchema/properties/q/description` → "Input q, description". */
export function findingPlace(location: string): string {
  const parts = location.split("/").filter(Boolean);
  if (parts.length === 0) return "The tool";
  const [head, ...rest] = parts;
  const side = head === "inputSchema" ? "Input" : head === "outputSchema" ? "Output" : null;
  if (side) {
    const fields: string[] = [];
    let i = 0;
    while (i < rest.length) {
      if (rest[i] === "properties" && rest[i + 1]) {
        fields.push(rest[i + 1]!);
        i += 2;
      } else if (rest[i] === "items") {
        i += 1;
      } else break;
    }
    const tail = rest.slice(i).join(" ");
    const where = fields.length > 0 ? `${side} ${fields.join(".")}` : `${side} schema`;
    return tail ? `${where}, ${tail}` : where;
  }
  if (head === "examples") {
    const n = Number(rest[0]);
    const tail = rest.slice(1).join(" ");
    const where = Number.isInteger(n) ? `Example ${n + 1}` : "Examples";
    return tail ? `${where}, ${tail}` : where;
  }
  if (head === "rules") return rest[0] && Number.isInteger(Number(rest[0])) ? `Check ${Number(rest[0]) + 1}` : "Checks on answers";
  const names: Record<string, string> = { summary: "Summary", description: "Description", name: "Name", tags: "Tags", category: "Topic" };
  return [names[head!] ?? head, ...rest].join(" ");
}

/* --------------------------------------------------------- versions table */

export interface VersionRow {
  version: number;
  semver: string;
  status: string;
  statusLabel: string;
  isCurrent: boolean;
  approved: boolean;
  publishedAt: string | null;
  sunsetAt: string | null;
  changelog: string | null;
  /** A major other than the current one, still active: it can be deprecated. */
  canDeprecate: boolean;
}

const VERSION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Live",
  DEPRECATED: "Deprecated",
  RETIRED: "Retired",
  DRAFT: "Draft",
};

/** Newest first, as the API sends them; the current major cannot be deprecated. */
export function versionRows(tool: Pick<ProviderTool, "versions" | "currentVersion">): VersionRow[] {
  const current = tool.versions.find((v) => v.version === tool.currentVersion) ?? tool.versions.find((v) => v.isCurrent) ?? null;
  const newestOfMajor = new Map<number, number>();
  for (const v of tool.versions) newestOfMajor.set(v.major, Math.max(newestOfMajor.get(v.major) ?? 0, v.version));
  return [...tool.versions]
    .sort((a, b) => b.version - a.version)
    .map((v) => ({
      version: v.version,
      semver: v.semver,
      status: v.status,
      statusLabel: VERSION_STATUS_LABEL[v.status] ?? v.status,
      isCurrent: v.isCurrent,
      approved: v.approved,
      publishedAt: v.publishedAt,
      sunsetAt: v.sunsetAt,
      changelog: v.changelog,
      canDeprecate: v.status === "ACTIVE" && current !== null && v.major !== current.major && newestOfMajor.get(v.major) === v.version,
    }));
}

/** The earliest sunset day the API accepts, from the tool's `earliestSunsetAt` (the first whole UTC day at or after it). */
export { sunsetDayFrom as earliestSunsetDay } from "@/features/contracts/text";

/* --------------------------------------------------------------- the form */

/** The operator editor's form, opened on a provider tool: its draft, else its newest version, else a starter. */
export function contractFormFor(tool: Pick<ProviderTool, "draft" | "versions"> | null): ContractForm {
  if (!tool) return formFor({ draft: null, versions: [] });
  const baseVersion = tool.draft?.baseSemver ? (tool.versions.find((v) => v.semver === tool.draft!.baseSemver)?.version ?? null) : null;
  const adapted = {
    draft: tool.draft ? { ...tool.draft, baseVersion } : null,
    versions: tool.versions,
  } as unknown as Pick<OperatorTool, "draft" | "versions">;
  return formFor(adapted);
}

/** The JSON text of the declared checks (`rules`), "[]" when none. */
export function rulesTextOf(version: Pick<ProviderToolVersion, "rules"> | null | undefined): string {
  return JSON.stringify(version?.rules ?? [], null, 2);
}

export interface ContractBodyResult {
  body: ProviderToolContractBody | null;
  errors: Partial<Record<"inputSchema" | "outputSchema" | "examples" | "rules", string>>;
}

/** The form and the rules text as the body `POST …/versions` (and create) takes. */
export function contractBody(form: ContractForm, rulesText: string): ContractBodyResult {
  const parsed = parseForm(form);
  const errors: ContractBodyResult["errors"] = { ...parsed.jsonErrors };
  let rules: Record<string, unknown>[] = [];
  const text = rulesText.trim() === "" ? "[]" : rulesText;
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) errors.rules = "The checks must be a JSON list: [ … ].";
    else rules = value as Record<string, unknown>[];
  } catch {
    errors.rules = "The checks are not valid JSON.";
  }
  if (!parsed.body || errors.rules) return { body: null, errors };
  const { baseVersion, ...rest } = parsed.body as ProviderToolContractBody;
  return {
    body: { ...rest, ...(baseVersion ? { baseVersion } : {}), ...(rules.length > 0 ? { rules } : { rules: [] }) },
    errors,
  };
}

export function createBody(localName: string, category: string, contract: ProviderToolContractBody): CreateProviderToolBody {
  const { baseVersion: _ignored, ...rest } = contract;
  return { ...rest, name: localName.trim(), category: category.trim() };
}

/* ----------------------------------------------------------------- errors */

export interface ProviderToolErrorView {
  text: string;
  problems: string[];
  /** A free name the server suggested. */
  suggestion: string | null;
  /** The gate refused: show the checklist. */
  gateFailed: boolean;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function providerToolErrorView(error: unknown): ProviderToolErrorView {
  const none = { problems: [] as string[], suggestion: null, gateFailed: false };
  if (!(error instanceof ApiError)) return { text: error instanceof Error ? error.message : "That did not work. Try again.", ...none };
  const context = (error.context ?? {}) as Record<string, unknown>;
  switch (error.code) {
    case "TOOL_PROVIDER_TOOL_INVALID":
      return { text: "It could not be saved. Fix these first:", ...none, problems: strings(context.problems).map(problemText) };
    case "TOOL_PROVIDER_TOOL_NAME_TAKEN": {
      const suggestion = typeof context.suggestion === "string" ? context.suggestion : null;
      return { text: suggestion ? `That name is taken. “${suggestion}” is free.` : "That name is taken. Try another one.", ...none, suggestion };
    }
    case "TOOL_PROVIDER_TOOL_NOT_ALLOWED":
      return {
        text: context.reason === "NO_HANDLE" ? "Claim a public name first: your tools are named after it." : "Register as a provider before publishing your own API.",
        ...none,
      };
    case "TOOL_PROVIDER_TOOL_GATE_FAILED":
      return { text: "Not yet: some checks are not met. See what to fix below.", ...none, gateFailed: true };
    case "TOOL_PROVIDER_TOOL_IN_REVIEW":
      return { text: "A review is pending, so it can't change now. Withdraw the review to edit it.", ...none };
    case "TOOL_PROVIDER_TOOL_STATE":
      return { text: typeof context.reason === "string" ? `Not possible now: ${context.reason}.` : "The tool changed in the meantime. Reload and try again.", ...none };
    case "TOOL_PROVIDER_TOOL_NOT_FOUND":
      return { text: "This tool no longer exists.", ...none };
    default:
      return { text: plainError(error.code), ...none };
  }
}
