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
  /** A list's item type, kept as it was ("string" for a new list). */
  itemType?: string;
}

/** What the rows don't show but the schema keeps: `additionalProperties`. */
export interface SchemaExtras {
  additionalProperties?: unknown;
}

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SIMPLE_KEYS = new Set(["type", "description"]);
const ARRAY_KEYS = new Set(["type", "description", "items"]);

/** The rows of a flat object schema, or null when it needs the JSON editor (including any schema the rows could not write back exactly). */
export function fieldsFromSchema(text: string): FieldRow[] | null {
  const rows = rowsOf(text);
  if (!rows) return null;
  // Lossless or not at all: the rows must write back the very schema they came from.
  const original = JSON.parse(text) as Record<string, unknown>;
  const back = JSON.parse(schemaFromFields(rows, schemaExtras(text))) as Record<string, unknown>;
  return canonical(normalised(back)) === canonical(normalised(original)) ? rows : null;
}

/** `required: []` and a missing `required` are the same schema. */
function normalised(schema: Record<string, unknown>): Record<string, unknown> {
  const { required, ...rest } = schema;
  return Array.isArray(required) && required.length > 0 ? { ...rest, required: [...(required as string[])].sort() } : rest;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The schema-level keys the rows keep without showing them. */
export function schemaExtras(text: string): SchemaExtras {
  try {
    const schema = JSON.parse(text) as Record<string, unknown>;
    return schema && typeof schema === "object" && "additionalProperties" in schema ? { additionalProperties: schema.additionalProperties } : {};
  } catch {
    return {};
  }
}

function rowsOf(text: string): FieldRow[] | null {
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
    const itemType = p.type === "array" && p.items ? String((p.items as { type: string }).type) : undefined;
    rows.push({ name, type: p.type as FieldType, required: required.has(name), description: typeof p.description === "string" ? p.description : "", ...(itemType ? { itemType } : {}) });
  }
  return rows;
}

/** The JSON Schema text the rows stand for. A list keeps its item type (text for a new list); `extras` keeps what the rows don't show. */
export function schemaFromFields(rows: readonly FieldRow[], extras: SchemaExtras = {}): string {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    properties[name] = {
      type: row.type,
      ...(row.type === "array" ? { items: { type: row.itemType ?? "string" } } : {}),
      ...(row.description.trim() ? { description: row.description.trim() } : {}),
    };
  }
  const required = rows.filter((r) => r.required && r.name.trim()).map((r) => r.name.trim());
  return JSON.stringify({ type: "object", properties, required, ...("additionalProperties" in extras ? { additionalProperties: extras.additionalProperties } : {}) }, null, 2);
}

/** What is wrong with the rows, in words; empty when they can be saved. */
export function fieldProblems(rows: readonly FieldRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const name = row.name.trim();
    if (!name) problems.push(`Field ${i + 1} needs a name.`);
    else if (!FIELD_NAME_RE.test(name)) problems.push(`“${name}”: use letters, digits and “_”, starting with a letter or “_”, at most 64 characters.`);
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

/** The fields of an object schema. */
export function schemaFieldNames(schema: unknown): string[] {
  const props = (schema as { properties?: unknown } | null)?.properties;
  return props && typeof props === "object" && !Array.isArray(props) ? Object.keys(props) : [];
}

/**
 * The fields an imported schema does not require, as the optional list: so
 * every field it brings is either required or optional, and the first save
 * is never blocked by "neither required nor an extra field".
 */
export function optionalFromSchema(schema: unknown): string[] {
  const required = new Set(Array.isArray((schema as { required?: unknown } | null)?.required) ? ((schema as { required: unknown[] }).required.filter((r) => typeof r === "string") as string[]) : []);
  return schemaFieldNames(schema).filter((name) => !required.has(name));
}
