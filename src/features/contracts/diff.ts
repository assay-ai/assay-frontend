import type { ContractChange, ContractChangeKind, ContractSchema, VersionBump } from "@/interfaces/contracts";

import { maxBump } from "./semver";

/**
 * The schema diff and the bump it implies — a hand mirror of assay-backend
 * `tool/domain/contract/contract-diff.ts` and `contract-shape.ts`, so the
 * operator editor can show the diff while someone types. The server computes
 * the same thing on save and its answer is the one publishing uses; this copy
 * only previews it. Pure.
 *
 * | Change                                          | Bump  |
 * |-------------------------------------------------|-------|
 * | summary, description, examples, annotations     | PATCH |
 * | an optional input or output field added         | MINOR |
 * | verification policy or tier changed             | MINOR |
 * | a field promoted, demoted, removed or renamed   | MAJOR |
 * | a type changed; a core field added; `required`  | MAJOR |
 */

export interface ContractShape {
  readonly summary: string;
  readonly description: string;
  readonly inputSchema: ContractSchema;
  readonly outputSchema: ContractSchema;
  readonly optionalInputFields: readonly string[];
  readonly optionalOutputFields: readonly string[];
  readonly examples: readonly unknown[];
  readonly verificationPolicyId?: string | null;
  readonly tier?: string | null;
}

export interface ContractDiff {
  /** null when nothing changed. */
  readonly bump: VersionBump | null;
  readonly changes: readonly ContractChange[];
}

const ANNOTATIONS = new Set(["description", "title", "examples", "$comment"]);

export function diffContracts(before: ContractShape | null, after: ContractShape): ContractDiff {
  if (!before) return { bump: null, changes: [] };
  const changes: ContractChange[] = [];
  const docs = (detail: string) => changes.push({ kind: "DOCS_CHANGED", side: null, field: null, bump: "PATCH", detail });

  if (before.summary !== after.summary) docs("summary changed");
  if (before.description !== after.description) docs("description changed");
  if (stable(before.examples) !== stable(after.examples)) docs("examples changed");
  if ((before.verificationPolicyId ?? null) !== (after.verificationPolicyId ?? null) || (before.tier ?? null) !== (after.tier ?? null)) {
    changes.push({ kind: "POLICY_CHANGED", side: null, field: null, bump: "MINOR", detail: "verification policy or tier changed" });
  }
  changes.push(
    ...diffSide("input", before.inputSchema, after.inputSchema, before.optionalInputFields, after.optionalInputFields),
    ...diffSide("output", before.outputSchema, after.outputSchema, before.optionalOutputFields, after.optionalOutputFields),
  );
  const bump = changes.reduce<VersionBump | null>((acc, change) => maxBump(acc, change.bump), null);
  return { bump, changes };
}

function diffSide(
  side: "input" | "output",
  before: ContractSchema,
  after: ContractSchema,
  optionalBefore: readonly string[],
  optionalAfter: readonly string[],
): ContractChange[] {
  const changes: ContractChange[] = [];
  const change = (kind: ContractChangeKind, field: string | null, bump: VersionBump, detail: string) =>
    changes.push({ kind, side, field, bump, detail });

  const topBefore = stable(withoutKeys(before, ["properties", "required"]), true);
  const topAfter = stable(withoutKeys(after, ["properties", "required"]), true);
  if (topBefore !== topAfter) {
    change("SCHEMA_CHANGED", null, "MAJOR", `${side} schema keywords changed`);
  } else if (stable(withoutKeys(before, ["properties", "required"])) !== stable(withoutKeys(after, ["properties", "required"]))) {
    change("DOCS_CHANGED", null, "PATCH", `${side} schema annotations changed`);
  }

  const propsBefore = (before?.properties ?? {}) as Record<string, unknown>;
  const propsAfter = (after?.properties ?? {}) as Record<string, unknown>;
  const requiredBefore = new Set(before?.required ?? []);
  const requiredAfter = new Set(after?.required ?? []);
  const fields = [...new Set([...Object.keys(propsBefore), ...Object.keys(propsAfter)])].sort();

  for (const field of fields) {
    const had = Object.prototype.hasOwnProperty.call(propsBefore, field);
    const has = Object.prototype.hasOwnProperty.call(propsAfter, field);
    const wasOptional = optionalBefore.includes(field);
    const isOptional = optionalAfter.includes(field);
    if (had && !has) {
      change("FIELD_REMOVED", field, "MAJOR", `${side} field ${field} removed`);
      continue;
    }
    if (!had && has) {
      if (isOptional && !requiredAfter.has(field)) change("FIELD_ADDED_OPTIONAL", field, "MINOR", `optional ${side} field ${field} added`);
      else change("FIELD_ADDED_CORE", field, "MAJOR", `core ${side} field ${field} added`);
      continue;
    }
    if (wasOptional && !isOptional) change("FIELD_PROMOTED", field, "MAJOR", `${side} field ${field} promoted to core`);
    else if (!wasOptional && isOptional) change("FIELD_DEMOTED", field, "MAJOR", `${side} field ${field} made optional`);
    if (requiredBefore.has(field) !== requiredAfter.has(field)) {
      change(
        "FIELD_REQUIRED_CHANGED",
        field,
        "MAJOR",
        `${side} field ${field} is ${requiredAfter.has(field) ? "now" : "no longer"} required`,
      );
    }
    if (stable(propsBefore[field], true) !== stable(propsAfter[field], true)) {
      change("TYPE_CHANGED", field, "MAJOR", `${side} field ${field} changed type`);
    } else if (stable(propsBefore[field]) !== stable(propsAfter[field])) {
      change("DOCS_CHANGED", field, "PATCH", `${side} field ${field} annotations changed`);
    }
  }
  return changes;
}

function withoutKeys(schema: ContractSchema | null | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema ?? {})) if (!keys.includes(key)) out[key] = value;
  return out;
}

function stable(value: unknown, stripAnnotations = false): string {
  return canonical(stripAnnotations ? stripSchema(value) : value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const SCHEMA_MAPS = new Set(["properties", "patternProperties", "definitions", "$defs"]);
const SCHEMA_VALUES = new Set(["items", "additionalProperties", "not", "anyOf", "oneOf", "allOf"]);

function stripSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (ANNOTATIONS.has(key)) continue;
    if (SCHEMA_MAPS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, stripSchema(child)]));
    } else if (SCHEMA_VALUES.has(key)) {
      out[key] = stripSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- problems */

export const SUMMARY_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 8_000;
export const EXAMPLES_MAX = 10;
export const EXAMPLE_MAX_BYTES = 2_048;
export const INPUT_SCHEMA_MAX_BYTES = 16_384;
const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}

/**
 * What stops a version from being saved or published, in the backend's
 * words (`contractProblems`). The screen rewords them with `problemText`.
 */
export function contractProblems(shape: ContractShape): string[] {
  const problems: string[] = [];
  const summary = shape.summary ?? "";
  if (summary.trim().length === 0) problems.push("summary is empty");
  if (summary.length > SUMMARY_MAX_LENGTH) problems.push(`summary is longer than ${SUMMARY_MAX_LENGTH} characters`);
  if (/[\r\n]/.test(summary)) problems.push("summary must be one line of plain text");
  if ((shape.description ?? "").trim().length === 0) problems.push("description is empty");
  if ((shape.description ?? "").length > DESCRIPTION_MAX_LENGTH) problems.push(`description is longer than ${DESCRIPTION_MAX_LENGTH} characters`);
  problems.push(...sideProblems("input", shape.inputSchema, shape.optionalInputFields));
  problems.push(...sideProblems("output", shape.outputSchema, shape.optionalOutputFields));
  if (bytes(shape.inputSchema) > INPUT_SCHEMA_MAX_BYTES) problems.push(`input schema is larger than ${INPUT_SCHEMA_MAX_BYTES} bytes`);
  if (!Array.isArray(shape.examples)) {
    problems.push("examples must be a list");
  } else {
    if (shape.examples.length > EXAMPLES_MAX) problems.push(`more than ${EXAMPLES_MAX} examples`);
    shape.examples.forEach((example, index) => {
      const value = example as Record<string, unknown> | null;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        problems.push(`example ${index + 1} is not an object`);
        return;
      }
      if (!value.arguments || typeof value.arguments !== "object" || Array.isArray(value.arguments)) {
        problems.push(`example ${index + 1} has no arguments object`);
      }
      if (bytes(value) > EXAMPLE_MAX_BYTES) problems.push(`example ${index + 1} is larger than ${EXAMPLE_MAX_BYTES} bytes`);
    });
  }
  return problems;
}

function sideProblems(side: "input" | "output", schema: ContractSchema, optional: readonly string[]): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [`${side} schema is not an object`];
  const problems: string[] = [];
  if (schema.type !== "object") problems.push(`${side} schema must have type "object"`);
  const properties = schema.properties ?? {};
  if (typeof properties !== "object" || Array.isArray(properties)) {
    problems.push(`${side} schema properties must be an object`);
    return problems;
  }
  for (const name of Object.keys(properties)) if (!FIELD_NAME_RE.test(name)) problems.push(`${side} field name "${name}" is not allowed`);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(properties, name)) problems.push(`${side} schema requires "${name}", which it does not define`);
  }
  if (new Set(optional).size !== optional.length) problems.push(`optional ${side} fields are listed twice`);
  for (const name of optional) {
    if (!Object.prototype.hasOwnProperty.call(properties, name)) problems.push(`optional ${side} field "${name}" is not in the ${side} schema`);
    else if (required.has(name)) problems.push(`optional ${side} field "${name}" cannot also be required`);
  }
  // Core means required: an output is either one every provider must return, or optional and opt-in.
  if (side === "output") {
    for (const name of Object.keys(properties)) {
      if (!required.has(name) && !optional.includes(name)) {
        problems.push(`output field "${name}" is neither required nor optional: make it required, or list it in optionalOutputFields`);
      }
    }
  }
  return problems;
}

/** The top-level field names of a schema, in order. */
export function schemaFields(schema: ContractSchema | null | undefined): string[] {
  const properties = schema?.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties) ? Object.keys(properties) : [];
}
