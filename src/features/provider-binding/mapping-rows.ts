import type { ToolMapping } from "@/interfaces";

import {
  EM_DASH,
  isObject,
  leafOf,
  literal,
  transformStepName,
  type Json,
  type Leaf,
} from "./mapping-model";

/**
 * Reading a stored mapping document well enough to table it — the binding mapping screen.
 *
 * `ToolMapping` is `Record<string, unknown>` on purpose: the mapping format is
 * a **spec language**, not a record, so there is no interface to widen it to.
 * This module does the one thing the design's two tables need — walk the
 * document and name each leaf — and returns rows, not a form model.
 *
 * It is still read-only. The write side is `./mapping-model`, and the grammar
 * that both of them need now lives there — `isSelector`, `literal`, `leafOf`
 * and the leaf shape were moved out of this file and are imported back, so
 * there is exactly one transcription of
 * assay-backend `src/modules/tool/domain/mapping/mapping.types.ts` in the frontend.
 * The dependency points that way (rows → model, never the reverse) because
 * `mapping-model.ts` must stay free of runtime imports.
 *
 * The rows below are a **display** projection: a `Status` string, an arrow-joined
 * transform chain, an `id` for the table. `mapping-model.ts`'s rows are the
 * editable one. They are different shapes on purpose and neither is derived
 * from the other.
 */

export { EM_DASH, isSelector, literal } from "./mapping-model";

/**
 * The Status column's vocabulary.
 *
 * The design draws exactly two static words — `ok` and `derived` — plus two
 * facts a **tester run** produces (`3 of 20 mapped`, `null on 3/3`) which this
 * screen has no source for. `optional` and `default` are ours, named after the
 * `$optional` / `$default` keys they report; both are in the report.
 */
function statusOf(leaf: Leaf): string {
  const marks: string[] = [];
  if (leaf.transforms.length > 0) marks.push("derived");
  if (leaf.optional) marks.push("optional");
  if (leaf.hasDefault) marks.push("default");
  return marks.length > 0 ? marks.join(" · ") : "ok";
}

// ── Request mapping ────────────────────────────────────────────────────────

export interface RequestRow {
  id: string;
  /** The selector into the tool's input, or `—` for a constant. */
  toolField: string;
  /** `identity`, `constant`, or the transform chain joined with `→`. */
  transform: string;
  /** Where the value lands on the provider's own request. */
  upstreamField: string;
  status: string;
}

function requestLeafRows(node: Json, destination: string, out: RequestRow[]): void {
  // A nested plain object under `query`/`body` is an ObjectNode: recurse so a
  // structured body is tabled leaf by leaf rather than dumped as JSON.
  if (
    isObject(node) &&
    !("$const" in node) &&
    !("$path" in node) &&
    !("$from" in node)
  ) {
    for (const [key, child] of Object.entries(node)) {
      requestLeafRows(child, `${destination}.${key}`, out);
    }
    return;
  }

  if (isObject(node) && "$from" in node) {
    const from = typeof node.$from === "string" ? node.$from : EM_DASH;
    out.push({
      id: destination,
      toolField: from,
      transform: "collection",
      upstreamField: destination,
      status: "ok",
    });
    const item = "$item" in node ? node.$item : node;
    requestLeafRows(item, `${destination}[]`, out);
    return;
  }

  const leaf = leafOf(node);
  const isConstant = leaf.selector === null;
  out.push({
    id: destination,
    toolField: leaf.selector ?? EM_DASH,
    transform: isConstant
      ? "constant"
      : leaf.transforms.length > 0
        ? leaf.transforms.map(transformStepName).join(" → ")
        : "identity",
    upstreamField: isConstant ? `${destination} = ${literal(leaf.constant)}` : destination,
    status: statusOf(leaf),
  });
}

/**
 * The rows behind "Request mapping".
 *
 * `method` and `path` are deliberately **not** rows: the design's columns are
 * Tool field / Transform / Upstream field / Status, and a request line is not
 * an upstream field. They are reachable through the panel's "View as YAML",
 * which shows the document whole. Noted in the report.
 */
export function requestRows(mapping: ToolMapping | null | undefined): RequestRow[] {
  if (!mapping) return [];
  const rows: RequestRow[] = [];

  const query = mapping.query;
  if (isObject(query)) {
    for (const [key, node] of Object.entries(query)) requestLeafRows(node, key, rows);
  }

  const headers = mapping.headers;
  if (isObject(headers)) {
    for (const [key, node] of Object.entries(headers)) requestLeafRows(node, `header:${key}`, rows);
  }

  if (mapping.body !== undefined) requestLeafRows(mapping.body, "body", rows);

  return rows;
}

/** The request line the table cannot carry: `GET /v1/forecast`. */
export function requestLine(mapping: ToolMapping | null | undefined): string | null {
  if (!mapping) return null;
  const method = typeof mapping.method === "string" ? mapping.method : null;
  const path = typeof mapping.path === "string" ? mapping.path : null;
  if (!method && !path) return null;
  return [method, path].filter(Boolean).join(" ");
}

// ── Response mapping ───────────────────────────────────────────────────────

export interface ResponseRow {
  id: string;
  /** The field on the tool's `outputSchema` this row produces. */
  outputField: string;
  /** The selector it reads, plus any transform chain. */
  from: string;
  status: string;
}

function responseWalk(node: Json, path: string, out: ResponseRow[]): void {
  if (isObject(node) && "$from" in node) {
    const from = typeof node.$from === "string" ? node.$from : EM_DASH;
    out.push({
      id: path || "$",
      outputField: path || EM_DASH,
      from,
      // The design puts a tester observation here ("3 of 20 mapped"). Without
      // a run there is nothing measured to say, so the row reports only that
      // the projection itself is well formed.
      status: "ok",
    });
    const item = "$item" in node ? node.$item : node;
    responseWalk(item, `${path}[]`, out);
    return;
  }

  if (
    isObject(node) &&
    !("$const" in node) &&
    !("$path" in node)
  ) {
    for (const [key, child] of Object.entries(node)) {
      responseWalk(child, path ? `${path}.${key}` : key, out);
    }
    return;
  }

  const leaf = leafOf(node);
  const chain =
    leaf.transforms.length > 0
      ? ` → ${leaf.transforms.map(transformStepName).join(" → ")}`
      : "";
  out.push({
    id: path || "$",
    outputField: path || EM_DASH,
    from: leaf.selector === null ? literal(leaf.constant) : `${leaf.selector}${chain}`,
    status: statusOf(leaf),
  });
}

export function responseRows(mapping: ToolMapping | null | undefined): ResponseRow[] {
  if (!mapping) return [];
  const rows: ResponseRow[] = [];
  responseWalk(mapping, "", rows);
  return rows;
}

// ── The primary surface ────────────────────────────────────────────────────

const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;

function yamlScalar(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  const needsQuotes =
    text === "" ||
    /^[\s>|*&!%@`'"#-]/.test(text) ||
    /[:#]\s/.test(text) ||
    /[\n\r\t]/.test(text) ||
    text !== text.trim() ||
    /^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(text);
  return needsQuotes ? JSON.stringify(text) : text;
}

function yamlKey(key: string): string {
  return PLAIN_KEY.test(key) ? key : JSON.stringify(key);
}

/**
 * The mapping document as YAML — the primary provider-facing view, and the
 * design's "View as YAML" action.
 *
 * No YAML package is installed and one is not worth adding to render two
 * stored objects, so this is a small emitter for the JSON subset a mapping can
 * contain. It is a **view**: nothing parses YAML back.
 */
export function toYaml(value: Json, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) =>
        isObject(item) || Array.isArray(item)
          ? `${pad}-\n${toYaml(item, indent + 1)}`
          : `${pad}- ${yamlScalar(item)}`
      )
      .join("\n");
  }

  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, child]) =>
        isObject(child) || Array.isArray(child)
          ? `${pad}${yamlKey(key)}:\n${toYaml(child, indent + 1)}`
          : `${pad}${yamlKey(key)}: ${yamlScalar(child)}`
      )
      .join("\n");
  }

  return `${pad}${yamlScalar(value)}`;
}
