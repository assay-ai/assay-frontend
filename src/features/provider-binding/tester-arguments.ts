/**
 * Why the mapping tester's arguments cannot be run yet, or `null` when they can.
 *
 * The arguments box is seeded with every field the request mapping reads, set
 * to `null` — the box shows the provider what to fill in, and has no value to
 * offer for them: the catalogue's input schemas carry no `examples` or
 * `default`, and a made-up `0` or `""` would be dialled at the real upstream
 * and could pass the publish gate on arguments nobody chose. Run as seeded,
 * the backend refuses it with `TOOL_MAPPING_NULL_VALUE` (BUG-J-POST-04).
 * This check stops that first run before it starts, and names the fields.
 *
 * The refusals the input schema decides for certain are caught here: a
 * required field that is absent or `null`, a `null` the schema does not allow
 * (`nullable: true` or a `"null"` type member allows it), and — so a value the
 * tool refuses is never dialled at the real upstream (BUG-PRV-CATALOG-07) — a
 * top-level number outside `minimum`/`maximum` (exclusive ones too), a string
 * outside `minLength`/`maxLength`, and a value not in `enum`. Types are checked
 * where the text is read (`argumentsFromText`); anything deeper stays the
 * backend's. Without a schema (the catalogue did not load) only the `null`
 * rule applies.
 */
export function argumentsProblem(
  args: Record<string, unknown>,
  inputSchema: Record<string, unknown> | undefined
): string | null {
  const properties = isRecord(inputSchema?.properties) ? inputSchema.properties : {};
  const required = Array.isArray(inputSchema?.required)
    ? inputSchema.required.filter((name): name is string => typeof name === "string")
    : [];

  const missing = required.filter((name) => args[name] === undefined || args[name] === null);
  if (missing.length > 0) {
    return `Enter ${list(missing)} before running: the tool requires ${missing.length === 1 ? "it" : "them"}.`;
  }

  const nulls = Object.keys(args).filter(
    (name) => args[name] === null && !allowsNull(properties[name])
  );
  if (nulls.length > 0) {
    return `${list(nulls)} cannot be null: enter a value or remove ${nulls.length === 1 ? "it" : "them"}.`;
  }

  for (const [name, value] of Object.entries(args)) {
    const problem = boundsProblem(name, value, properties[name]);
    if (problem) return problem;
  }

  return null;
}

/** The range, length and enum rules of one top-level field, in words. */
function boundsProblem(name: string, value: unknown, schema: unknown): string | null {
  if (!isRecord(schema) || value === null || value === undefined) return null;
  const field = `“${name}”`;
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => sameValue(option, value))) {
    const options = schema.enum.filter((option) => typeof option === "string" || typeof option === "number").map(String);
    return options.length > 0 && options.length <= 8
      ? `${field} must be one of ${options.join(", ")}.`
      : `${field} is not one of the values the tool takes.`;
  }
  if (typeof value === "number") {
    const min = numberOr(schema.minimum);
    const max = numberOr(schema.maximum);
    // Draft 4 marks the bound exclusive with a boolean; later drafts give the bound itself.
    const exclusiveMin = numberOr(schema.exclusiveMinimum) ?? (schema.exclusiveMinimum === true ? min : null);
    const exclusiveMax = numberOr(schema.exclusiveMaximum) ?? (schema.exclusiveMaximum === true ? max : null);
    if (exclusiveMin !== null && value <= exclusiveMin) return `${field} must be more than ${exclusiveMin}.`;
    if (exclusiveMax !== null && value >= exclusiveMax) return `${field} must be less than ${exclusiveMax}.`;
    if (min !== null && value < min) return `${field} must be at least ${min}.`;
    if (max !== null && value > max) return `${field} must be at most ${max}.`;
  }
  if (typeof value === "string") {
    const length = [...value].length;
    const minLength = numberOr(schema.minLength);
    const maxLength = numberOr(schema.maxLength);
    if (minLength !== null && length < minLength) return `${field} must be at least ${minLength} character${minLength === 1 ? "" : "s"}.`;
    if (maxLength !== null && length > maxLength) return `${field} must be at most ${maxLength} character${maxLength === 1 ? "" : "s"}.`;
  }
  return null;
}

function numberOr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Whether a typed value is this enum option. `argumentsFromText` turns text
 * into a number or boolean only where the field's type says so; a field with
 * no type stays text, so a string matches a number or boolean option of the
 * same text ("10" is 10). Objects and arrays compare by value, whatever the
 * key order.
 */
function sameValue(option: unknown, value: unknown): boolean {
  if (option === value) return true;
  if (typeof value === "string" && (typeof option === "number" || typeof option === "boolean")) return String(option) === value;
  return deepEqual(option, value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

function allowsNull(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.nullable === true) return true;
  return schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
