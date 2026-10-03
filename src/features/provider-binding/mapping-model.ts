import type {
  MappingOnNull,
  MappingRequestRow,
  MappingRequestSection,
  MappingResponseRow,
  MappingRowModel,
  MappingRowSource,
  MappingTransformStep,
  ToolMapping,
} from "@/interfaces";

/**
 * A binding mapping, both ways.
 *
 * ## What this is
 *
 * `mapping-rows.ts` reads a stored mapping into display rows and says in its
 * own header that nothing there ever writes one back. This module is the
 * write side: it projects a document into the editor's rows (`toRows`),
 * builds a **canonical** document back out of them (`fromRows`), and decides
 * whether a given document may be edited as rows at all
 * (`canExpressAsRows`).
 *
 * The grammar is not re-transcribed. It lives here once — `isSelector`,
 * `literal`, `leafOf` and friends moved *out of* `mapping-rows.ts` and that
 * module now imports them back. The dependency points this way on purpose:
 * this file's only import is a **type-only** one, so `node
 * --experimental-strip-types` can execute it directly and the round-trip can
 * be proved without a test runner, a bundler or a path-alias resolver.
 *
 * ## Canonical, never shorthand
 *
 * assay-backend `docs/mapping-format.md` §Shorthand: the terse form a provider types
 * (`"$.foo"`, `"en"`) survives exactly one function call — `normalizeMappingNode`
 * — and the console persists the canonical `$`-directive form. So `fromRows`
 * emits `{ "$path": "$.foo" }` and `{ "$const": "en" }`, never the bare
 * string. Writing shorthand back would work for every mapping that exists
 * today and break on the first provider who needs the escape hatch the
 * canonical form *is*: `{ "$const": "$.literally this" }`.
 *
 * ## Why the round-trip has to be exact
 *
 * Backend normalisation is idempotent, so a stored mapping must come back out
 * of this editor byte-identical when nothing was edited. If it does not, a
 * save that changed nothing still raises `mapping_version`, and raising it
 * Invalidates a green mapping-tester run — which blocks publish with
 * no visible cause. `canExpressAsRows` therefore does not merely inspect the
 * document: it runs the projection and compares. A shape this model would
 * rewrite is a shape it refuses, and the refusal sends the binding to the
 * raw-JSON editor with the document intact.
 *
 * ## What a row cannot hold
 *
 * `$from` projections, and with them `$item` and `$onEmpty`. Also any leaf
 * whose canonical form carries a key the row's columns do not name. Both are
 * rejected rather than approximated: a row editor that dropped a `$from` on
 * save would delete a provider's mapping.
 *
 * Transforms **are** carried whole, arguments included — see
 * {@link MappingTransformStep}. An earlier cut of this model held them as
 * bare names, which would have put every binding using `split` or `join`
 * behind the JSON editor permanently.
 *
 * ## The two refusals that are not about expressiveness
 *
 * An explicit `$optional: false` or `$onNull: "PASS"` means exactly what
 * omitting the key means, and the row model omits it — so such a document is
 * refused, not rewritten. If real provider data turns out to contain them
 * commonly, the fix is a **presence flag on the row** that remembers the key
 * was written out. It is never to relax the comparison in
 * `canExpressAsRows`: that comparison is the only thing standing between a
 * no-op save and a `mapping_version` bump.
 *
 * Grammar source: assay-backend `src/modules/tool/domain/mapping/{mapping.types,normalize}.ts`
 * and assay-backend `docs/mapping-format.md`.
 */

/** The design's glyph for "there is nothing here", used in `—` cells. */
export const EM_DASH = "—";

export type Json = unknown;
export type JsonObject = Record<string, unknown>;

export function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The backend's rule for a bare string, from `normalizeMappingNode`'s
 * `looksLikeSelector`: `$.` / `$[` / `@.` / `@[` prefixed, or the bare roots
 * `$` and `@`, are selectors; everything else is a constant.
 *
 * The `@` forms only ever appear inside a `$from` item template, which this
 * model refuses outright — they are matched anyway so that a document being
 * *classified* is classified the way the backend would.
 */
export function isSelector(value: string): boolean {
  return (
    value === "$" ||
    value === "@" ||
    value.startsWith("$.") ||
    value.startsWith("$[") ||
    value.startsWith("@.") ||
    value.startsWith("@[")
  );
}

/** Render a JSON literal the way the design writes one: `format = json`, unquoted. */
export function literal(value: Json): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return EM_DASH;
  return JSON.stringify(value);
}

/** One resolved leaf of a mapping document. */
export interface Leaf {
  /** The selector this leaf reads, or `null` when it is a constant. */
  selector: string | null;
  /** Named transforms, in application order, arguments and all. */
  transforms: MappingTransformStep[];
  /** Present (as a JSON value) only when the leaf is a constant. */
  constant?: Json;
  optional: boolean;
  hasDefault: boolean;
  /** Only meaningful when `hasDefault`; `$default: null` is a real default. */
  defaultValue?: Json;
  onNull: MappingOnNull;
}

const NULL_POLICIES: readonly MappingOnNull[] = ["PASS", "DEFAULT", "ERROR"];

/**
 * Read a `$transform` list, preserving each step's stored form.
 *
 * A bare string stays a bare string and an object stays an object, `args`
 * key present or absent exactly as found — that fidelity is the whole point
 * (see {@link MappingTransformStep}).
 *
 * A step that is neither becomes the literal `"?"`, which is what the display
 * rows have always rendered for one. It is also a value no document can
 * contain, so such a mapping fails `canExpressAsRows`' comparison and is
 * never offered as a table.
 */
export function transformSteps(node: JsonObject): MappingTransformStep[] {
  const raw = node.$transform;
  if (!Array.isArray(raw)) return [];
  return raw.map((step) => {
    if (typeof step === "string") return step;
    if (isObject(step) && typeof step.name === "string") {
      return "args" in step
        ? { name: step.name, args: step.args as Record<string, unknown> | undefined }
        : { name: step.name };
    }
    return "?";
  });
}

/** The name of a step, whichever of the two forms it is written in. */
export function transformStepName(step: MappingTransformStep): string {
  return typeof step === "string" ? step : step.name;
}

/** A step's arguments, or `undefined` when it carries none. */
export function transformStepArgs(
  step: MappingTransformStep,
): Record<string, unknown> | undefined {
  return typeof step === "string" ? undefined : step.args;
}

/** Copy a step structurally, so an emitted document shares nothing with its rows. */
function copyTransformStep(step: MappingTransformStep): MappingTransformStep {
  if (typeof step === "string") return step;
  return "args" in step ? { name: step.name, args: step.args } : { name: step.name };
}

function nullPolicyOf(node: JsonObject): MappingOnNull {
  const raw = node.$onNull;
  return typeof raw === "string" && (NULL_POLICIES as readonly string[]).includes(raw)
    ? (raw as MappingOnNull)
    : "PASS";
}

export function leafOf(node: Json): Leaf {
  if (typeof node === "string") {
    return isSelector(node)
      ? { selector: node, transforms: [], optional: false, hasDefault: false, onNull: "PASS" }
      : {
          selector: null,
          transforms: [],
          constant: node,
          optional: false,
          hasDefault: false,
          onNull: "PASS",
        };
  }
  if (!isObject(node)) {
    return {
      selector: null,
      transforms: [],
      constant: node,
      optional: false,
      hasDefault: false,
      onNull: "PASS",
    };
  }
  if ("$const" in node) {
    return {
      selector: null,
      transforms: transformSteps(node),
      constant: node.$const,
      optional: false,
      hasDefault: false,
      onNull: "PASS",
    };
  }
  const hasDefault = "$default" in node;
  return {
    selector: typeof node.$path === "string" ? node.$path : null,
    transforms: transformSteps(node),
    optional: node.$optional === true,
    hasDefault,
    ...(hasDefault ? { defaultValue: node.$default } : {}),
    onNull: nullPolicyOf(node),
  };
}

// ── Projection: document → rows ────────────────────────────────────────────

/** The only top-level keys a request mapping may carry (`RequestMappingSpec`). */
const REQUEST_KEYS: readonly string[] = ["method", "path", "query", "headers", "body"];

/**
 * Thrown by `toRows` for a document the flat row model cannot hold.
 *
 * It throws rather than dropping the offending node, because a projection
 * that silently omitted a `$from` would be indistinguishable from a mapping
 * that never had one — and the next save would write the omission back.
 * `canExpressAsRows` catches it; call that first.
 */
export class MappingNotExpressibleError extends Error {
  /** Where in the document, as a dotted path. */
  at: string;

  constructor(message: string, at: string) {
    super(`${message}${at ? ` at "${at}"` : ""}`);
    this.name = "MappingNotExpressibleError";
    this.at = at;
  }
}

function refuse(message: string, at: string): never {
  throw new MappingNotExpressibleError(message, at);
}

/** A plain object node — an object that is not one of the three directive nodes. */
function isObjectNode(node: Json): node is JsonObject {
  return isObject(node) && !("$const" in node) && !("$path" in node) && !("$from" in node);
}

function sourceOf(leaf: Leaf, at: string): MappingRowSource {
  if (leaf.selector !== null) return { kind: "selector", selector: leaf.selector };
  if (leaf.constant === undefined) {
    refuse("leaf is neither a readable selector nor a constant", at);
  }
  return { kind: "constant", value: leaf.constant };
}

/** One leaf → one row. Refuses anything that is not a leaf. */
function rowOf(target: string, node: Json): MappingResponseRow {
  if (isObject(node) && "$from" in node) {
    refuse("$from projections cannot be edited as rows", target);
  }
  if (isObjectNode(node)) {
    refuse("a nested object where a single value belongs", target);
  }
  const leaf = leafOf(node);
  return {
    target,
    source: sourceOf(leaf, target),
    transforms: leaf.transforms,
    optional: leaf.optional,
    ...(leaf.hasDefault ? { default: leaf.defaultValue } : {}),
    onNull: leaf.onNull,
  };
}

/** Walk an object node into one row per leaf, keyed by its dotted path. */
function collectRows(node: Json, prefix: string, out: MappingResponseRow[]): void {
  if (isObject(node) && "$from" in node) {
    refuse("$from projections cannot be edited as rows", prefix);
  }
  if (isObjectNode(node)) {
    const entries = Object.entries(node);
    if (entries.length === 0) {
      refuse("an empty object has no row to stand for it", prefix);
    }
    for (const [key, child] of entries) {
      if (key.length === 0 || key.includes(".")) {
        // A dotted key is indistinguishable from nesting once a row's target
        // is a dotted path, so the document is handed to the JSON editor
        // rather than silently re-shaped.
        refuse(`key "${key}" cannot be spelled as a dotted row target`, prefix);
      }
      if (key.startsWith("$")) {
        refuse(`unknown directive "${key}"`, prefix);
      }
      collectRows(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out.push(rowOf(prefix, node));
}

/**
 * Which side of the binding a document belongs to, when the caller does not
 * say.
 *
 * The editor always knows — it is editing `requestMapping` or
 * `responseMapping` — and should pass `direction`. This fallback exists only
 * so a document can be classified on its own, and it looks at the one
 * signal a response mapping cannot forge: a top-level `method` or `path`
 * whose value is a bare string. In canonical form every leaf is an object,
 * so a top-level string is a request line and nothing else.
 */
export function inferDirection(mapping: JsonObject): "REQUEST" | "RESPONSE" {
  return typeof mapping.method === "string" || typeof mapping.path === "string"
    ? "REQUEST"
    : "RESPONSE";
}

/**
 * Project a stored mapping document into editor rows.
 *
 * Throws {@link MappingNotExpressibleError} for anything the rows cannot
 * hold. Gate every call with {@link canExpressAsRows}.
 */
export function toRows(
  mapping: ToolMapping,
  direction?: "REQUEST" | "RESPONSE",
): MappingRowModel {
  if (!isObject(mapping)) {
    refuse("a mapping must be an object", "");
  }
  const side = direction ?? inferDirection(mapping);

  if (side === "RESPONSE") {
    const rows: MappingResponseRow[] = [];
    collectRows(mapping, "", rows);
    return { direction: "RESPONSE", rows };
  }

  for (const key of Object.keys(mapping)) {
    if (!REQUEST_KEYS.includes(key)) {
      refuse(`"${key}" is not part of a request mapping`, "");
    }
  }

  const rows: MappingRequestRow[] = [];
  const sections: MappingRequestSection[] = [];

  for (const section of ["query", "headers"] as const) {
    const value = mapping[section];
    if (value === undefined) continue;
    if (!isObject(value)) refuse(`${section} must be an object`, section);
    sections.push(section);
    for (const [key, node] of Object.entries(value)) {
      if (key.length === 0) refuse("an empty parameter name", section);
      // `query` and `headers` are flat by nature; the backend refuses a
      // nested object there, so `rowOf` is used directly rather than the
      // recursive walker.
      rows.push({ ...rowOf(key, node), section });
    }
  }

  if (mapping.body !== undefined) {
    sections.push("body");
    const bodyRows: MappingResponseRow[] = [];
    collectRows(mapping.body, "", bodyRows);
    for (const row of bodyRows) rows.push({ ...row, section: "body" });
  }

  return {
    direction: "REQUEST",
    method: typeof mapping.method === "string" ? mapping.method : null,
    path: typeof mapping.path === "string" ? mapping.path : null,
    sections,
    rows,
  };
}

// ── Emission: rows → a canonical document ──────────────────────────────────

/**
 * One row → one canonical node.
 *
 * Only what the row actually declares is written. `$optional: false`,
 * `$onNull: "PASS"` and an empty `$transform` are the format's defaults and
 * are spelled as absent keys — which is exactly what the backend's
 * `normalizePathNode` emits, so a document that came from the backend goes
 * back unchanged.
 */
function nodeOf(row: MappingResponseRow): JsonObject {
  if (row.source.kind === "constant") {
    return { $const: row.source.value };
  }
  const node: JsonObject = { $path: row.source.selector };
  if ("default" in row && row.default !== undefined) node.$default = row.default;
  if (row.optional) node.$optional = true;
  if (row.onNull !== "PASS") node.$onNull = row.onNull;
  if (row.transforms.length > 0) {
    // Emitted in the form each step arrived in. `normalizeTransformStep`
    // accepts both forms but does NOT preserve them — it collapses `"trim"` to
    // `{ name: "trim", args: {} }` — so a bare string is unreachable in stored
    // data through any write path, and it is the object form this fidelity
    // actually carries, arguments and all. What protects the round trip
    // against a save that changed nothing is the absent-key handling above.
    node.$transform = row.transforms.map(copyTransformStep);
  }
  return node;
}

/** Rebuild a nested object node from rows carrying dotted targets. */
function treeOf(rows: readonly MappingResponseRow[]): Json {
  if (rows.length === 1 && rows[0].target === "") return nodeOf(rows[0]);

  const root: JsonObject = {};
  for (const row of rows) {
    const parts = row.target.split(".");
    let cursor = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const next = cursor[parts[index]];
      if (isObject(next)) {
        cursor = next;
      } else {
        const created: JsonObject = {};
        cursor[parts[index]] = created;
        cursor = created;
      }
    }
    cursor[parts[parts.length - 1]] = nodeOf(row);
  }
  return root;
}

/**
 * Build the canonical `$`-directive document the rows describe.
 *
 * This is what a save writes. It is total — every model produces a document —
 * because every model came from a document {@link canExpressAsRows} approved,
 * or from the editor's own row form.
 */
export function fromRows(model: MappingRowModel): ToolMapping {
  if (model.direction === "RESPONSE") {
    const built = treeOf(model.rows);
    return isObject(built) ? built : {};
  }

  const document: JsonObject = {};
  if (model.method !== null) document.method = model.method;
  if (model.path !== null) document.path = model.path;

  const present = new Set<MappingRequestSection>(model.sections);
  for (const row of model.rows) present.add(row.section);

  for (const section of ["query", "headers"] as const) {
    if (!present.has(section)) continue;
    const flat: JsonObject = {};
    for (const row of model.rows) {
      if (row.section === section) flat[row.target] = nodeOf(row);
    }
    document[section] = flat;
  }

  if (present.has("body")) {
    document.body = treeOf(model.rows.filter((row) => row.section === "body"));
  }

  return document;
}

// ── The switch ─────────────────────────────────────────────────────────────

/** Structural JSON equality. No runtime dependency, by design — see the header. */
function deepEquals(left: Json, right: Json): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEquals(item, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && deepEquals(left[key], right[key]),
  );
}

/**
 * May this document be edited as a table?
 *
 * `false` sends the binding to the raw-JSON editor with the document
 * untouched. It is deliberately the conservative answer to everything
 * uncertain, and the test is not a checklist of shapes — it is the round trip
 * itself:
 *
 *   1. `toRows` refuses outright what it cannot name — a `$from` projection,
 *      a nested object under `query`, an empty object node, a key a dotted
 *      target cannot spell, a stray top-level key on a request mapping.
 *   2. Whatever survives is emitted again and compared to the original.
 *
 * Step 2 is what makes the answer trustworthy without enumerating the
 * grammar a second time. Any document the model would *rewrite* — an
 * explicit `$optional: false`, an `$onNull: "PASS"` written out, a transform
 * carrying `args`, a leaf still in shorthand — fails the comparison and goes
 * to JSON. The editor can then only ever save a document byte-identical to
 * the one it loaded, which is the property that keeps a no-op edit from
 * raising `mapping_version` and invalidating a green tester run.
 */
export function canExpressAsRows(
  mapping: ToolMapping | null | undefined,
  direction?: "REQUEST" | "RESPONSE",
): boolean {
  if (!isObject(mapping)) return false;
  try {
    return deepEquals(fromRows(toRows(mapping, direction)), mapping);
  } catch {
    return false;
  }
}
