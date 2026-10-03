/**
 * Pure readers over one `BindingTestReport`.
 *
 * Everything here is a *projection* of what `POST
 * /providers/me/tool-bindings/{id}/test` returned. Nothing re-derives a
 * verdict, re-orders a stage or re-runs a rule: the mapping tester screen's whole reason to exist
 * is that a provider can predict production from it, and a frontend that
 * computed even one of those numbers itself would be predicting the frontend
 * instead. Where the API returns nothing, these return nothing — never a
 * plausible substitute.
 *
 * `mapped`, `request.body` and the two mapping documents are genuinely
 * `unknown` (their shape is whatever the tool's schema says), so they are read
 * structurally — `key in node` guards, no casts to a shape we guessed.
 */

import type {
  BindingTestReport,
  ToolMapping,
  VerificationRuleResult,
  VerificationStage,
  VerificationStageResult,
} from "@/interfaces";

/** Pretty JSON for a value whose shape is open. Never asserts a type onto it. */
export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // A cycle cannot survive the wire, but a `BigInt` could reach this from a
    // future field. Better an honest marker than a thrown render.
    return "/* value could not be serialised */";
  }
}

/** `https://api.open-meteo.com` → `api.open-meteo.com`, or the string unchanged. */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** The path the tester actually built, for the pane head. Falls back to the whole url. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** `{ latitude: "52.52" }` from the url the tester reports it sent. */
export function queryOf(url: string): Record<string, string> | null {
  try {
    const parsed = new URL(url);
    const entries = [...parsed.searchParams.entries()];
    return entries.length === 0 ? null : Object.fromEntries(entries);
  } catch {
    return null;
  }
}

/** The `$path` selector at a mapping node, or `null` when the node is not one. */
export function selectorOf(node: unknown): string | null {
  if (typeof node !== "object" || node === null || !("$path" in node)) return null;
  const path = (node as { $path: unknown }).$path;
  return typeof path === "string" ? path : null;
}

/** The `$const` literal at a mapping node, or `undefined` when the node is not one. */
export function constOf(node: unknown): unknown {
  if (typeof node !== "object" || node === null || !("$const" in node)) return undefined;
  return (node as { $const: unknown }).$const;
}

export interface MappingPair {
  /** The output field this node fills. */
  field: string;
  /** The selector it reads, when it reads one. */
  selector: string | null;
  /** The literal it writes, when it writes one. */
  literal: unknown;
  /** The node verbatim, for anything that is neither. */
  node: unknown;
}

/**
 * One entry per top-level key of a mapping document, in document order.
 *
 * Document order is the order the engine reports selectors in, so preserving
 * it is what lets the coverage table line up against `validate-mapping`'s
 * `selectors` array without a join.
 */
export function mappingPairs(mapping: ToolMapping | undefined): MappingPair[] {
  if (!mapping) return [];
  return Object.entries(mapping).map(([field, node]) => ({
    field,
    selector: selectorOf(node),
    literal: constOf(node),
    node,
  }));
}

/** The `query` sub-document of a request mapping, if it has one. */
export function requestQueryPairs(mapping: ToolMapping | undefined): MappingPair[] {
  if (!mapping || !("query" in mapping)) return [];
  const query = mapping.query;
  if (typeof query !== "object" || query === null || Array.isArray(query)) return [];
  return mappingPairs(query as ToolMapping);
}

export interface MappedField {
  present: boolean;
  value: unknown;
}

/** Whether the mapped document carries `field`, read structurally. */
export function mappedField(mapped: unknown, field: string): MappedField {
  if (typeof mapped !== "object" || mapped === null || Array.isArray(mapped)) {
    return { present: false, value: undefined };
  }
  if (!(field in mapped)) return { present: false, value: undefined };
  return { present: true, value: (mapped as Record<string, unknown>)[field] };
}

/** How many top-level keys the mapped document actually carries. */
export function mappedFieldCount(mapped: unknown): number {
  if (typeof mapped !== "object" || mapped === null || Array.isArray(mapped)) return 0;
  return Object.keys(mapped).length;
}

/** `"number"`, `"string"`, `"null"`, `"array"`, `"object"` — for the coverage row. */
export function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * The stage labels the design writes, verbatim (the verdict panel, rows
 * `schema`, `cross-check`, `semantic`). `DETERMINISTIC_RULES` has no row of its
 * own in the design — its rules are listed at the top level by their own type —
 * so the label below is only used when the API returns that stage with no
 * `rules` array to expand.
 */
const STAGE_LABEL: Record<VerificationStage, string> = {
  SCHEMA: "schema",
  DETERMINISTIC_RULES: "deterministic rules",
  CROSS_CHECK: "cross-check",
  SEMANTIC: "semantic",
};

export function stageLabel(stage: VerificationStage): string {
  return STAGE_LABEL[stage] ?? String(stage).toLowerCase().replace(/_/g, " ");
}

/** One row of the verdict table. Order is the API's, never re-sorted. */
export interface VerdictRow {
  id: string;
  /** Left column. A stage word, or a rule's type. */
  check: string;
  /** The status word plus, where the API gave one, its own detail sentence. */
  result: string;
  /** The API's own `detail`, kept apart so a long one can be surfaced in full. */
  detail: string | null;
  failed: boolean;
  /** `null` where the API reports no weight — a stage row, never a rule. */
  weight: number | null;
  /**
   * DERIVED, and the only derived number on this screen: the API returns a
   * per-rule `weight` and a per-stage `score`, but no per-rule contribution.
   * A passed rule contributes its weight and a failed one contributes zero —
   * which is the arithmetic the stage `score` already reflects, so the TOTAL
   * row below is taken from the API's `score` rather than from summing these.
   * If the two ever disagree the reader sees it, which is the point.
   */
  contribution: number | null;
}

const STAGE_STATUS_WORD: Record<VerificationStageResult["status"], string> = {
  PASSED: "pass",
  FAILED: "fail",
  NOT_REACHED: "not reached",
  NOT_APPLICABLE: "not applicable",
  NOT_IMPLEMENTED: "not implemented",
};

const RULE_OUTCOME_WORD: Record<VerificationRuleResult["outcome"], string> = {
  PASSED: "pass",
  FAILED: "fail",
  NOT_APPLICABLE: "not applicable",
  EMPTY_COLLECTION: "empty collection",
};

function joined(word: string, detail: string | null): string {
  return detail ? `${word} · ${detail}` : word;
}

/**
 * The stages, flattened into the design's row list, in the API's own order.
 *
 * A stage that carries `rules` is replaced by its rules — that is what the design
 * draws (schema, then `MIN_ARRAY_LENGTH`, `REQUIRED_FIELDS`, `VALID_URL`,
 * `NO_DUPLICATES`, `FRESHNESS`, then cross-check, then semantic) and it is also
 * what a provider needs: the stage's verdict is the rules' verdict, and a
 * collapsed row would hide which rule cost them the call.
 */
export function verdictRows(stages: readonly VerificationStageResult[]): VerdictRow[] {
  const rows: VerdictRow[] = [];

  stages.forEach((stage, stageIndex) => {
    if (stage.rules && stage.rules.length > 0) {
      stage.rules.forEach((rule, ruleIndex) => {
        const failed = rule.outcome === "FAILED";
        rows.push({
          id: `${stageIndex}-rule-${ruleIndex}-${rule.ruleId}`,
          check: rule.type,
          result: joined(RULE_OUTCOME_WORD[rule.outcome] ?? rule.outcome, rule.detail),
          detail: rule.detail,
          failed,
          weight: rule.weight,
          contribution:
            rule.outcome === "PASSED" ? rule.weight : rule.outcome === "FAILED" ? 0 : null,
        });
      });
      return;
    }

    const failed = stage.status === "FAILED";
    // The design writes "valid" for a passed schema stage. Every other stage
    // word comes from the table above, and every sentence after the `·` is the
    // API's own `detail`.
    const word =
      stage.stage === "SCHEMA" && stage.status === "PASSED"
        ? "valid"
        : (STAGE_STATUS_WORD[stage.status] ?? stage.status);

    rows.push({
      id: `${stageIndex}-${stage.stage}`,
      check: stageLabel(stage.stage),
      result: joined(word, stage.detail),
      detail: stage.detail,
      failed,
      weight: null,
      contribution: null,
    });
  });

  return rows;
}

/** The score the API attributes to the stage that carried rules, if any. */
export function scoredStage(
  stages: readonly VerificationStageResult[]
): VerificationStageResult | null {
  return stages.find((stage) => stage.rules && stage.rules.length > 0) ?? null;
}

/** The first stage the API marked FAILED, with its own sentence. */
export function firstFailedStage(
  stages: readonly VerificationStageResult[]
): VerificationStageResult | null {
  return stages.find((stage) => stage.status === "FAILED") ?? null;
}

/** Rules whose `pointer` names this output field. Only a failure carries one. */
export function rulesPointingAt(
  stages: readonly VerificationStageResult[],
  field: string
): VerificationRuleResult[] {
  const wanted = `/${field}`;
  return stages
    .flatMap((stage) => stage.rules ?? [])
    .filter((rule) => rule.pointer === wanted);
}

/** `0.4` → `"0.40"`. Weights and contributions are two-decimal in the design. */
export function twoDecimals(value: number): string {
  return value.toFixed(2);
}

/** Byte length of the raw body as it arrived, for the upstream pane head. */
export function byteSize(raw: string | null): string | null {
  if (raw === null) return null;
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** `2026-08-21T02:41:04.130Z` → `02:41:04`, in the reader's own zone. */
export function clockOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(undefined, { hour12: false });
}

/**
 * The run's revision against the binding's current one.
 *
 * `BindingTestReport.mappingVersion` is what the publish gate keys on, so a run
 * taken before an edit is not evidence for the revision now on screen. The
 * screen has to say so out loud — a green tester panel over a changed mapping
 * is precisely the "tuned against a lie" failure this screen exists to prevent.
 */
export function isStaleRun(report: BindingTestReport, bindingVersion: number): boolean {
  return report.mappingVersion !== bindingVersion;
}
