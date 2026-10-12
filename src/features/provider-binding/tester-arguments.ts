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
 * Only the two refusals the input schema decides for certain are caught here:
 * a required field that is absent or `null`, and a `null` the schema does not
 * allow (`nullable: true` or a `"null"` type member allows it). Everything else
 * — types, ranges — stays the backend's, whose run report says it better.
 * Without a schema (the catalogue did not load) only the `null` rule applies.
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

  return null;
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
