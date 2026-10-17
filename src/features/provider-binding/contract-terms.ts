import { compareSemverText, bindingMajors, formatVersionRange, majorsText } from "@/features/contracts/semver";
import { sunsetDay } from "@/features/contracts/text";
import type { ToolContractVersion, ToolVersionStatus } from "@/interfaces/contracts";
import type {
  BindingTestReport,
  CatalogueTool,
  PublishCheck,
  PublishRequirementResult,
  ToolBindingDetail,
} from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";

/**
 * A binding's contract terms (design spec §7.5, T3): which contract versions
 * (majors) it serves, and which optional fields it returns or accepts. Pure;
 * the panel and the wizard only lay these out.
 *
 * A changed range or a changed field list is a new revision of the binding:
 * it needs a new passing test for every major it serves, then a publish.
 */

export interface ContractTerms {
  /** Ascending, distinct. */
  majors: number[];
  /** Optional outputs this binding returns. */
  provides: string[];
  /** Optional inputs this binding passes on. */
  supports: string[];
}

/** One major a provider can tick: its newest version and where it stands. */
export interface MajorChoice {
  major: number;
  /** The newest published version of this major: the one a test runs against. */
  version: number;
  semver: string;
  status: ToolVersionStatus;
  sunsetAt: string | null;
  /** Unpinned URLs serve this major. */
  current: boolean;
  optionalOutputs: string[];
  optionalInputs: string[];
}

/** The newest published version of each major, newest major first. */
export function majorChoices(tool: Pick<CatalogueTool, "versions" | "currentVersion">): MajorChoice[] {
  const versions = (tool.versions ?? []).filter((v) => v.status !== "DRAFT");
  const byMajor = new Map<number, ToolContractVersion>();
  for (const v of versions) {
    const seen = byMajor.get(v.major);
    if (!seen || compareSemverText(v.semver, seen.semver) > 0) byMajor.set(v.major, v);
  }
  const currentMajor = currentMajorOf(tool);
  return [...byMajor.values()]
    .sort((a, b) => b.major - a.major)
    .map((v) => ({
      major: v.major,
      version: v.version,
      semver: v.semver,
      status: v.status,
      sunsetAt: v.sunsetAt,
      current: v.major === currentMajor,
      optionalOutputs: [...v.optionalOutputFields],
      optionalInputs: [...v.optionalInputFields],
    }));
}

/** The major unpinned URLs serve, or the highest published one; 1 when the tool has no versions. */
export function currentMajorOf(tool: Pick<CatalogueTool, "versions" | "currentVersion">): number {
  const versions = tool.versions ?? [];
  const flagged = versions.find((v) => v.isCurrent);
  if (flagged) return flagged.major;
  const fromText = Number((tool.currentVersion ?? "").split(".")[0]);
  if (Number.isInteger(fromText) && fromText > 0) return fromText;
  return versions.reduce((max, v) => Math.max(max, v.major), 0) || 1;
}

/** What a new binding starts with: the current major, no extra fields. */
export function defaultTerms(tool: Pick<CatalogueTool, "versions" | "currentVersion">): ContractTerms {
  return { majors: [currentMajorOf(tool)], provides: [], supports: [] };
}

/** The terms a stored binding has; a backend before T3 reads as `^1` and no extra fields. */
export function termsOf(binding: Pick<ToolBindingDetail, "toolVersionRange" | "providesOutputFields" | "supportsInputFields">): ContractTerms {
  return {
    majors: bindingMajors(binding.toolVersionRange),
    provides: [...(binding.providesOutputFields ?? [])].sort(),
    supports: [...(binding.supportsInputFields ?? [])].sort(),
  };
}

/** The optional fields offered for the majors ticked: the union of their newest versions'. */
export function offeredFields(choices: readonly MajorChoice[], majors: readonly number[]): { outputs: string[]; inputs: string[] } {
  const picked = choices.filter((c) => majors.includes(c.major));
  return {
    outputs: [...new Set(picked.flatMap((c) => c.optionalOutputs))].sort(),
    inputs: [...new Set(picked.flatMap((c) => c.optionalInputs))].sort(),
  };
}

/** Ticks or unticks a major, and drops any field the remaining majors no longer offer. */
export function toggleMajor(terms: ContractTerms, choices: readonly MajorChoice[], major: number): ContractTerms {
  const majors = terms.majors.includes(major)
    ? terms.majors.filter((m) => m !== major)
    : [...terms.majors, major].sort((a, b) => a - b);
  const offered = offeredFields(choices, majors);
  return {
    majors,
    provides: terms.provides.filter((f) => offered.outputs.includes(f)),
    supports: terms.supports.filter((f) => offered.inputs.includes(f)),
  };
}

export function toggleField(terms: ContractTerms, kind: "provides" | "supports", field: string): ContractTerms {
  const list = terms[kind];
  const next = list.includes(field) ? list.filter((f) => f !== field) : [...list, field].sort();
  return { ...terms, [kind]: next };
}

/** The body fields `POST`/`PATCH /providers/me/tool-bindings` take. */
export function termsBody(terms: ContractTerms): { toolVersionRange: string; providesOutputFields: string[]; supportsInputFields: string[] } {
  return {
    toolVersionRange: formatVersionRange(terms.majors),
    providesOutputFields: [...terms.provides],
    supportsInputFields: [...terms.supports],
  };
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export function sameTerms(a: ContractTerms, b: ContractTerms): boolean {
  return sameList(a.majors, b.majors) && sameList([...a.provides].sort(), [...b.provides].sort()) && sameList([...a.supports].sort(), [...b.supports].sort());
}

/** Why the terms can't be saved, or null. */
export function termsProblem(terms: ContractTerms, choices: readonly MajorChoice[]): string | null {
  if (choices.length === 0) return null;
  if (terms.majors.length === 0) return "Pick at least one version to serve.";
  const retired = choices.filter((c) => c.status === "RETIRED" && terms.majors.includes(c.major));
  if (retired.length > 0) return `${majorsText(retired.map((c) => c.major))} no longer serves calls. Untick it.`;
  return null;
}

/** "Stops on Feb 1, 2027 (UTC)", "No longer serves calls", "Current", or null. */
export function majorNote(choice: MajorChoice): string | null {
  if (choice.status === "RETIRED") return "Retired: no longer serves calls";
  if (choice.status === "DEPRECATED") return choice.sunsetAt ? `Stops on ${sunsetDay(choice.sunsetAt)} (UTC)` : "Being retired";
  if (choice.current) return "Current: what agents get by default";
  return null;
}

/**
 * When every major a binding serves is on its way out: what to do, naming the
 * date and the version to add. null when it serves at least one live major.
 *
 *   "v1 stops on Feb 1, 2027 (UTC). Add v2, check the mapping and run a test to keep serving calls."
 */
export function moveNotice(terms: ContractTerms, choices: readonly MajorChoice[]): string | null {
  const served = choices.filter((c) => terms.majors.includes(c.major));
  if (served.length === 0 || served.some((c) => c.status === "ACTIVE")) return null;
  const target = choices.find((c) => c.status === "ACTIVE" && c.current) ?? choices.find((c) => c.status === "ACTIVE");
  const add = target ? ` Add v${target.major}, check the mapping and run a test to keep serving calls.` : "";
  const retired = served.filter((c) => c.status === "RETIRED");
  if (retired.length === served.length) return `${majorsText(served.map((c) => c.major))} no longer serves calls.${add}`;
  const soonest = served
    .filter((c) => c.status === "DEPRECATED" && c.sunsetAt)
    .sort((a, b) => Date.parse(a.sunsetAt!) - Date.parse(b.sunsetAt!))[0];
  const when = soonest?.sunsetAt ? ` stops on ${sunsetDay(soonest.sunsetAt)} (UTC).` : " is being retired.";
  return `${majorsText(served.map((c) => c.major))}${when}${add}`;
}

/** The sentence a changed range or field list earns: it is a new revision. */
export const TERMS_CHANGED_NOTICE = "You changed what this listing serves. Run a new test for each version, then publish again.";

/* ------------------------------------------------------------- the tester */

/** The runs one "Run the test" makes: one per major served, newest version of each. */
export function testTargets(terms: ContractTerms, choices: readonly MajorChoice[]): { major: number; version: number | undefined; semver: string | null }[] {
  if (choices.length === 0) return [{ major: terms.majors[0] ?? 1, version: undefined, semver: null }];
  return terms.majors.map((major) => {
    const choice = choices.find((c) => c.major === major);
    return { major, version: choice?.version, semver: choice?.semver ?? null };
  });
}

/** "Contract v2 (2.0.0)" — the header of a run's row. */
export function runLabel(major: number, report: Pick<BindingTestReport, "toolVersionSemver"> | null, semver: string | null): string {
  const shown = report?.toolVersionSemver ?? semver;
  return shown ? `Contract v${major} (${shown})` : `Contract v${major}`;
}

/* --------------------------------------------------------- the publish gate */

const CONTRACT_PREFIX = /^Contract v(\d+):\s*/;

/** "Contract v2: No test at this revision." → { major: 2, rest: "No test at this revision." }. */
export function splitMajorDetail(detail: string | null): { major: number | null; rest: string | null } {
  if (!detail) return { major: null, rest: null };
  const match = CONTRACT_PREFIX.exec(detail);
  if (!match) return { major: null, rest: detail };
  const rest = detail.slice(match[0].length).trim();
  return { major: Number(match[1]), rest: rest.length > 0 ? rest : null };
}

export interface GateRow extends PublishRequirementResult {
  /** The contract major this row is about; null for a row that is not per major. */
  major: number | null;
}

/**
 * The publish check as rows, with the tester requirements once per major.
 * The backend sends one entry per failing major ("Contract v2: …") and a
 * single entry when every major passed; with more than one major, that single
 * passed entry is shown once per major so each version reads as checked.
 */
export function gateRows(check: Pick<PublishCheck, "requirements">, majors: readonly number[]): GateRow[] {
  const rows: GateRow[] = [];
  for (const requirement of check.requirements) {
    const tester = requirement.requirement === "TESTER_RUN" || requirement.requirement === "TESTER_PASSED";
    const { major, rest } = splitMajorDetail(requirement.detail);
    if (tester && major !== null) {
      rows.push({ ...requirement, detail: rest, major });
    } else if (tester && requirement.met && majors.length > 1) {
      for (const m of majors) rows.push({ ...requirement, major: m });
    } else {
      rows.push({ ...requirement, major: tester && majors.length === 1 ? majors[0]! : null });
    }
  }
  return rows;
}

/* --------------------------------------------- PROVIDER_BINDING_CONTRACT_MISMATCH */

const MISMATCH_TEXT: ReadonlyArray<readonly [RegExp, (m: RegExpExecArray) => string]> = [
  [/^contract v(\d+) has no published version to serve$/, (m) => `Version ${m[1]} of this tool doesn't exist yet, so you can't serve it. Untick v${m[1]}.`],
  [
    /^"(.+)" is not an optional output of the contract in (.+)$/,
    (m) => `"${m[1]}" isn't an extra field of ${rangeWords(m[2]!)}. Untick it under "Extra fields you return".`,
  ],
  [
    /^"(.+)" is not an optional input of the contract in (.+)$/,
    (m) => `"${m[1]}" isn't an extra input of ${rangeWords(m[2]!)}. Untick it under "Extra inputs you accept".`,
  ],
  [
    /^the request mapping never reads "(.+)", so it would be dropped$/,
    (m) => `You say you accept "${m[1]}", but your mapping never sends it to your API. Add it under Advanced mapping, or untick it.`,
  ],
  [/^"(.*)" is not a version range/, () => "Pick the versions you serve again."],
];

function rangeWords(range: string): string {
  const majors = bindingMajors(range);
  return majors.length === 1 ? `version ${majors[0]}` : `versions ${majorsText(majors).replace(/v/g, "")}`;
}

/** One backend problem of a contract mismatch, in plain words. */
export function mismatchProblemText(problem: string): string {
  for (const [re, say] of MISMATCH_TEXT) {
    const match = re.exec(problem.trim());
    if (match) return say(match);
  }
  const text = problem.trim();
  return text.length === 0 ? "This listing doesn't fit the tool's contract." : `${text[0]!.toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
}

/** The plain problems of a PROVIDER_BINDING_CONTRACT_MISMATCH, or null for any other error. */
export function contractMismatchProblems(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || error.code !== "PROVIDER_BINDING_CONTRACT_MISMATCH") return null;
  const raw = error.context?.problems;
  const problems = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
  return problems.length > 0 ? problems.map(mismatchProblemText) : ["This listing doesn't fit the tool's contract. Check the versions and extra fields you picked."];
}

/** One line per contract major of the publish check: "Contract v2: tested and passed" or what is missing. */
export interface MajorTestRow {
  major: number;
  met: boolean;
  /** What is missing, in the backend's words, or null when met. */
  detail: string | null;
}

/** The tester half of the publish check, merged to one row per major (run + passed). */
export function majorTestRows(check: Pick<PublishCheck, "requirements">, majors: readonly number[]): MajorTestRow[] {
  const tester = gateRows(check, majors).filter(
    (r) => (r.requirement === "TESTER_RUN" || r.requirement === "TESTER_PASSED") && r.major !== null,
  );
  const byMajor = new Map<number, MajorTestRow>();
  for (const m of majors) byMajor.set(m, { major: m, met: true, detail: null });
  for (const row of tester) {
    const seen = byMajor.get(row.major!) ?? { major: row.major!, met: true, detail: null };
    if (!row.met && seen.met) byMajor.set(row.major!, { major: row.major!, met: false, detail: row.detail });
    else if (!byMajor.has(row.major!)) byMajor.set(row.major!, seen);
  }
  return [...byMajor.values()].sort((a, b) => a.major - b.major);
}

/** "Contract v2: tested and passed" / "Contract v2: No test run at this revision." */
export function majorTestText(row: MajorTestRow): string {
  return row.met ? `Contract v${row.major}: tested and passed` : `Contract v${row.major}: ${row.detail ?? "needs a passing test"}`;
}

/** "Serves contract v1 · also returns uv_index · also accepts units" — the Overview line. */
export function servedSummary(terms: ContractTerms): string {
  const parts = [`Serves contract ${majorsText(terms.majors) || "v1"}`];
  if (terms.provides.length > 0) parts.push(`also returns ${terms.provides.join(", ")}`);
  if (terms.supports.length > 0) parts.push(`also accepts ${terms.supports.join(", ")}`);
  return parts.join(" · ");
}
