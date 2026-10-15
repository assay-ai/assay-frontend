import type { ToolMapping } from "@/interfaces";

/**
 * One plain sentence for each mapping, shown in the wizard instead of the
 * mapping editor by default ("We send city and units to your API as query
 * parameters."). The editor itself sits behind "Advanced mapping".
 *
 * Tolerant on purpose: it reads both the canonical (`{ "$path": "$.city" }`)
 * and the shorthand (`"$.city"`) leaf forms, and anything it does not
 * recognise is simply not named — the sentence is a summary, never the source
 * of truth.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "$.city" / "$.units?" / "$.vessel.mmsi" → "city" / "units" / "vessel.mmsi". */
function fieldOf(selector: string): string {
  return selector.replace(/^\$\.?/, "").replace(/\?$/, "");
}

interface Leaves {
  fields: string[];
  constants: number;
}

function collect(node: unknown, into: Leaves): void {
  if (typeof node === "string") {
    if (node.startsWith("$.")) into.fields.push(fieldOf(node));
    else into.constants += 1;
    return;
  }
  if (typeof node === "number" || typeof node === "boolean") {
    into.constants += 1;
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collect(item, into));
    return;
  }
  if (!isRecord(node)) return;
  if (typeof node.$path === "string") {
    into.fields.push(fieldOf(node.$path));
    return;
  }
  if ("$const" in node) {
    into.constants += 1;
    return;
  }
  if (node.$from !== undefined) {
    collect(node.$from, into);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("$")) collect(value, into);
  }
}

function leavesOf(node: unknown): Leaves {
  const leaves: Leaves = { fields: [], constants: 0 };
  collect(node, leaves);
  leaves.fields = [...new Set(leaves.fields.filter(Boolean))];
  return leaves;
}

/** ["a"] → "a"; ["a","b"] → "a and b"; ["a","b","c"] → "a, b and c". */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const WHERE: Record<string, [string, string]> = {
  query: ["as a query parameter", "as query parameters"],
  headers: ["as a header", "as headers"],
  body: ["in the request body", "in the request body"],
};

export function requestMappingSummary(mapping: ToolMapping | null | undefined): string {
  if (!isRecord(mapping)) return "We send the tool's input to your API.";
  const parts: string[] = [];
  let constants = 0;
  for (const section of ["query", "headers", "body"] as const) {
    const leaves = leavesOf(mapping[section]);
    constants += leaves.constants;
    if (leaves.fields.length === 0) continue;
    const [one, many] = WHERE[section]!;
    parts.push(`${listJoin(leaves.fields)} ${leaves.fields.length === 1 ? one : many}`);
  }
  const fromPath = typeof mapping.path === "string" ? [...mapping.path.matchAll(/\{([^}]+)\}/g)].map((m) => fieldOf(m[1]!)) : [];
  if (fromPath.length > 0) parts.push(`${listJoin(fromPath)} in the address`);
  const fixed = constants > 0 ? ` We also add ${constants === 1 ? "1 fixed value" : `${constants} fixed values`}.` : "";
  if (parts.length === 0) return `We call your API with no input from the agent.${fixed}`;
  return `We send ${listJoin(parts)} to your API.${fixed}`;
}

export function responseMappingSummary(mapping: ToolMapping | null | undefined): string {
  if (!isRecord(mapping)) return "We read the result from your API's answer.";
  const targets = Object.keys(mapping).filter((key) => !key.startsWith("$"));
  if (targets.length === 0) return "We pass your API's answer through as the result.";
  return `We read ${listJoin(targets)} from your API's answer.`;
}
