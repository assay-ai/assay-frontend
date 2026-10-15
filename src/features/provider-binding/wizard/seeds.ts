import type { CatalogueTool, ToolMapping } from "@/interfaces";

import { schemaFields, type SchemaField } from "../mapping-editor";

/**
 * Starting points for a new listing, so stage 2 opens filled in rather than
 * blank: a request mapping that forwards every tool argument as a query
 * parameter of the same name, a response mapping that reads every output
 * field from the same name, and test arguments taken from the schema's own
 * `examples` / `example` / `default` / first `enum` value.
 */

export function seedRequestMapping(tool: CatalogueTool): ToolMapping {
  const fields = schemaFields(tool.inputSchema);
  const seed: ToolMapping = { method: "GET", path: "/" };
  if (fields.length > 0) {
    seed.query = Object.fromEntries(fields.map((field) => [field.name, { $path: `$.${field.name}` }]));
  }
  return seed;
}

export function seedResponseMapping(tool: CatalogueTool): ToolMapping {
  return Object.fromEntries(
    schemaFields(tool.outputSchema).map((field) => [field.name, { $path: `$.${field.name}` }]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The schema's own example for one field, as the text an input shows. */
export function exampleOf(schema: Record<string, unknown> | undefined, name: string): string {
  const properties = isRecord(schema?.properties) ? schema.properties : {};
  const spec = properties[name];
  if (!isRecord(spec)) return "";
  const candidates: unknown[] = [
    Array.isArray(spec.examples) ? spec.examples[0] : undefined,
    spec.example,
    spec.default,
    Array.isArray(spec.enum) ? spec.enum[0] : undefined,
  ];
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null);
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function seedArguments(schema: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(schemaFields(schema).map((field) => [field.name, exampleOf(schema, field.name)]));
}

/** The text of each argument box → the JSON input a test run sends, typed by the schema. */
export function argumentsFromText(
  fields: readonly SchemaField[],
  values: Readonly<Record<string, string>>,
): { input: Record<string, unknown>; error: string | null } {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const text = (values[field.name] ?? "").trim();
    if (text === "") continue;
    switch (field.type) {
      case "number":
      case "integer": {
        const value = Number(text);
        if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
          return { input, error: `“${field.name}” must be ${field.type === "integer" ? "a whole number" : "a number"}.` };
        }
        input[field.name] = value;
        break;
      }
      case "boolean":
        if (text !== "true" && text !== "false") return { input, error: `“${field.name}” must be true or false.` };
        input[field.name] = text === "true";
        break;
      case "object":
      case "array":
        try {
          input[field.name] = JSON.parse(text);
        } catch {
          return { input, error: `“${field.name}” must be valid JSON.` };
        }
        break;
      default:
        input[field.name] = text;
    }
  }
  return { input, error: null };
}

/** "Returns: temperature, time" — what a tool gives back, in a provider's words. */
export function returnsLine(tool: Pick<CatalogueTool, "outputSchema">): string | null {
  const fields = schemaFields(tool.outputSchema);
  if (fields.length === 0) return null;
  const words = fields.map((field) => field.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase());
  return `Returns: ${words.join(", ")}`;
}

/** "Needs: symbol" — what a tool is called with. */
export function needsLine(tool: Pick<CatalogueTool, "inputSchema">): string | null {
  const fields = schemaFields(tool.inputSchema).filter((field) => field.required);
  if (fields.length === 0) return null;
  return `Needs: ${fields.map((field) => field.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase()).join(", ")}`;
}
