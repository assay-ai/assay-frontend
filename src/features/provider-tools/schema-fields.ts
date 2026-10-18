/**
 * The simple field editor behind "What agents send" and "What your API
 * returns": a flat object schema as rows (name, type, required,
 * description), so a provider never has to write JSON Schema by hand. Pure.
 * Anything richer than a flat object (nested objects with their own
 * properties, enums, formats, `$ref`) is edited as JSON instead.
 */

export const FIELD_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Readonly<Record<FieldType, string>> = {
  string: "Text",
  number: "Number",
  integer: "Whole number",
  boolean: "Yes / no",
  array: "List",
  object: "Object",
};

export interface FieldRow {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
}

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SIMPLE_KEYS = new Set(["type", "description"]);
const ARRAY_KEYS = new Set(["type", "description", "items"]);

/** The rows of a flat object schema, or null when it needs the JSON editor. */
export function fieldsFromSchema(text: string): FieldRow[] | null {
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch {
    return null;
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const s = schema as { type?: unknown; properties?: unknown; required?: unknown };
  if (s.type !== "object") return null;
  const extra = Object.keys(s).filter((k) => !["type", "properties", "required", "additionalProperties"].includes(k));
  if (extra.length > 0) return null;
  const props = (s.properties ?? {}) as Record<string, unknown>;
  if (typeof props !== "object" || Array.isArray(props)) return null;
  const required = new Set(Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string") : []);
  const rows: FieldRow[] = [];
  for (const [name, raw] of Object.entries(props)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const p = raw as { type?: unknown; description?: unknown; items?: unknown };
    if (!FIELD_TYPES.includes(p.type as FieldType)) return null;
    const allowed = p.type === "array" ? ARRAY_KEYS : SIMPLE_KEYS;
    if (Object.keys(p).some((k) => !allowed.has(k))) return null;
    if (p.type === "array" && p.items !== undefined) {
      const items = p.items as { type?: unknown } | null;
      if (!items || typeof items !== "object" || Object.keys(items).some((k) => k !== "type") || typeof items.type !== "string") return null;
    }
    rows.push({ name, type: p.type as FieldType, required: required.has(name), description: typeof p.description === "string" ? p.description : "" });
  }
  return rows;
}

/** The JSON Schema text the rows stand for. A list holds text unless the JSON editor says otherwise. */
export function schemaFromFields(rows: readonly FieldRow[]): string {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    properties[name] = {
      type: row.type,
      ...(row.type === "array" ? { items: { type: "string" } } : {}),
      ...(row.description.trim() ? { description: row.description.trim() } : {}),
    };
  }
  const required = rows.filter((r) => r.required && r.name.trim()).map((r) => r.name.trim());
  return JSON.stringify({ type: "object", properties, required }, null, 2);
}

/** What is wrong with the rows, in words; empty when they can be saved. */
export function fieldProblems(rows: readonly FieldRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const name = row.name.trim();
    if (!name) problems.push(`Field ${i + 1} needs a name.`);
    else if (!FIELD_NAME_RE.test(name)) problems.push(`“${name}”: use letters, digits and “_”, starting with a letter.`);
    else if (seen.has(name)) problems.push(`“${name}” is there twice.`);
    seen.add(name);
  }
  return problems;
}

/** Fields that are not required are the optional ones (an output field must be one or the other). */
export function optionalNames(rows: readonly FieldRow[]): string[] {
  return rows.filter((r) => !r.required && r.name.trim()).map((r) => r.name.trim());
}

function sample(type: FieldType, name: string): unknown {
  switch (type) {
    case "string":
      return `example ${name}`;
    case "number":
      return 1.5;
    case "integer":
      return 10;
    case "boolean":
      return true;
    case "array":
      return [`example ${name}`];
    case "object":
      return {};
  }
}

/** A starter example from the two field lists: one call, with a value of the right type in each field. */
export function starterExample(input: readonly FieldRow[], output: readonly FieldRow[]): Record<string, unknown> {
  const of = (rows: readonly FieldRow[]) => Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), sample(r.type, r.name.trim())]));
  return { title: "A typical call", arguments: of(input), result: of(output) };
}

/** A starter check on answers: a list in the output must not come back empty, else the first required field must be there. */
export function starterCheck(output: readonly FieldRow[]): Record<string, unknown> | null {
  const list = output.find((r) => r.type === "array" && r.name.trim());
  if (list) return { id: `${list.name.trim()}_not_empty`, type: "MIN_ARRAY_LENGTH", path: `$.${list.name.trim()}`, min: 1 };
  const required = output.filter((r) => r.required && r.name.trim()).map((r) => r.name.trim());
  return required.length > 0 ? { id: "has_required_fields", type: "REQUIRED_FIELDS", path: "$", fields: required } : null;
}
