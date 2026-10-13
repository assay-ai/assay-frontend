"use client";

import { Plus, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeBlock } from "@/components/ui/code-block";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import type {
  MappingDirection,
  MappingOnNull,
  MappingRequestSection,
  MappingResponseRow,
  MappingRowModel,
  MappingRowSource,
  MappingTransformStep,
  ToolMapping,
  ValidateMappingResponse,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { validateToolMapping } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";

import {
  EM_DASH,
  MappingNotExpressibleError,
  canExpressAsRows,
  fromRows,
  isObject,
  literal,
  toRows,
  transformStepArgs,
  transformStepName,
} from "./mapping-model";

/**
 * The binding mapping screen · the binding mapping, **written** rather than only read.
 *
 * ## What this is
 *
 * `mapping-rows.ts` renders a stored document; `mapping-model.ts` is the
 * write side and is where the grammar lives. This file is the surface over
 * that model and adds no grammar of its own: every document it emits comes
 * out of `fromRows`, every table it offers was approved by
 * `canExpressAsRows`, and the two forms of a transform step are read through
 * `transformStepName` / `transformStepArgs` rather than by touching the
 * union.
 *
 * ## The rows come from the schema, not from the mapping
 *
 * A response mapping that never writes `temperatureC` is not a mapping with
 * two rows and a gap somewhere — it is a mapping with a row that is **empty**,
 * and the tool's `outputSchema` is the only thing that knows the row should be
 * there. So the rows are the schema's fields, in schema order, each carrying
 * whatever the document says about it; document leaves the schema does not
 * name are appended after them rather than dropped.
 *
 * A request mapping has no such contract to draw rows from: its targets are
 * the provider's own query, header and body keys, which no platform schema
 * describes. `inputSchema` is what the mapping may *read*, so it is rendered
 * as the list of available selectors under the table.
 *
 * ## `$optional`
 *
 * The checkbox in the Status column appears in no design and is the one
 * control here that a provider cannot work around. `mapping-format.md`
 * §Selectors: *"writing a selector is an assertion that the field is there"*,
 * and a selector that resolves to nothing with neither `$default` nor
 * `$optional` raises `TOOL_MAPPING_PATH_NOT_FOUND`. That default is deliberate
 * and loud — but without a way to say "this field is legitimately absent" the
 * only way out of it is a typo hunt for a field that was never there.
 *
 * Optionality is therefore a **declaration, never an inference**. Nothing here
 * infers it from a selector that failed once, and the format does not either.
 *
 * The backend's `contract-check.ts` refuses `$optional` at a schema-`required`
 * site unless the row also carries a `$default` — the field would then be
 * always written, so the document cannot legally be invalid. That refusal is a
 * 400 at save time; it is surfaced here as guidance under the table instead,
 * because a provider who meets it as an HTTP error has already lost the edit.
 *
 * ## The JSON escape hatch
 *
 * Anything `canExpressAsRows` refuses opens as raw JSON with the table gone
 * and a sentence saying why. It is never offered as a table with the offending
 * node quietly missing: a `$from` projection dropped on the way in would be
 * deleted on the way out. `toRows` is called inside a `try` as a second belt —
 * it throws {@link MappingNotExpressibleError} rather than dropping a node,
 * and this file's refusal sentence is built from that throw.
 *
 * ## Errors from the validator are not row-level
 *
 * `POST /validate-mapping` answers `TOOL_MAPPING_*` through the ordinary error
 * path, and `BaseError.toJSON()` serialises `errorCode`, `message`,
 * `statusCode` and `timestamp` — it drops the `pointer`, `direction` and
 * `fault` the engine attached. The wire therefore carries no machine-readable
 * way to reach a row, and parsing the human sentence for one would attach a
 * red border to whichever row a message happened to name. The message is shown
 * against the **direction**, whole.
 */

// ── The closed transform registry ──────────────────────────────────────────

/**
 * `mapping-format.md` §Transforms. Closed on purpose — adding one is a deploy,
 * because it is new behaviour every stored mapping can suddenly reach.
 *
 * This list is a **hand mirror** of
 * assay-backend `src/modules/tool/domain/mapping/transforms.ts`, with no sync guard:
 * no endpoint publishes the registry, so a transform added there is invisible
 * here until someone copies it across. A name this build has never heard of is
 * therefore kept rather than corrected — see the `<option>` fallback below —
 * and so are its arguments; the two together are what stop an unknown step
 * being quietly rewritten into something the backend would reject.
 */
const TRANSFORMS: readonly string[] = [
  "trim",
  "lowercase",
  "uppercase",
  "toString",
  "toNumber",
  "toInteger",
  "toBoolean",
  "epochSecondsToIso",
  "epochMillisToIso",
  "isoDate",
  "jsonParse",
  "split",
  "join",
  "first",
  "coalesceEmptyToNull",
];

/**
 * The only two steps in *this* list that take arguments, and the only argument
 * they take.
 *
 * `TransformDefinition.args` on the backend is an open `readonly string[]`, so
 * a future transform may take others. Nothing here may key on this set alone
 * when deciding whether a step **has** arguments — see `retype`, which keeps
 * whatever a step already carries.
 */
const TAKES_SEPARATOR = new Set(["split", "join"]);

const NULL_POLICIES: readonly MappingOnNull[] = ["PASS", "DEFAULT", "ERROR"];
const SECTIONS: readonly MappingRequestSection[] = ["query", "headers", "body"];

// ── Documents ──────────────────────────────────────────────────────────────

/**
 * Structural equality, so that "changed" means changed.
 *
 * `fromRows` emits a request document as `method, path, query, headers, body`
 * whatever order the stored one used, so `JSON.stringify` comparison reports a
 * difference in a document nobody edited — and a save that changes nothing
 * still raises `mapping_version`, which invalidates a green tester run and
 * blocks publish with no visible cause. `mapping-model`'s own `deepEquals` is
 * private (it is load-bearing for `canExpressAsRows` and must not grow a
 * second caller that might want it to be laxer), so this is its own copy.
 */
export function documentsEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => documentsEqual(item, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) && documentsEqual(left[key], right[key])
  );
}

/**
 * A JSON literal typed into a cell.
 *
 * The same rule the format's shorthand uses for everything that is not a
 * selector: `10`, `true`, `null` and `["a"]` are their JSON values, and
 * anything that is not JSON is the string itself. A row that was **not**
 * edited never goes through this — it hands back the value it was loaded with,
 * so a stored `"10"` does not become a number by being looked at.
 */
function parseLiteral(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

// ── The tool's schema ──────────────────────────────────────────────────────

export interface SchemaField {
  name: string;
  required: boolean;
  /** The declared JSON type, when the schema states one. */
  type: string | null;
}

/** The top-level fields of a JSON Schema object, in the order it declares them. */
export function schemaFields(schema: Record<string, unknown> | undefined): SchemaField[] {
  if (!schema) return [];
  const properties = isObject(schema.properties) ? schema.properties : null;
  if (!properties) return [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  return Object.keys(properties).map((name) => {
    const spec = properties[name];
    return {
      name,
      required: required.includes(name),
      type: isObject(spec) && typeof spec.type === "string" ? spec.type : null,
    };
  });
}

// ── The editor's row ───────────────────────────────────────────────────────

/**
 * One editable row.
 *
 * Not `MappingResponseRow`: that type's `source` is a required tagged union,
 * and the row this editor most needs to draw is the one with **no source at
 * all** — a schema field the mapping never writes. It carries the text a
 * provider is mid-way through typing, which a document cannot hold either.
 * `modelRowOf` converts it back to the model's row on the way out.
 */
interface EditorRow {
  /** Stable React key. Not the target — a target is editable and may be empty. */
  id: string;
  target: string;
  /** Request only; a response row always reports `body` and nothing reads it. */
  section: MappingRequestSection;
  /** The tool's `outputSchema` lists this field under `required`. */
  required: boolean;
  /** The row exists because the schema names it, not because the document did. */
  fromSchema: boolean;
  kind: "selector" | "constant";
  /** The selector, or the constant rendered as a literal. */
  text: string;
  /** What the constant was loaded as, so an untouched row emits it unchanged. */
  originalText?: string;
  originalValue?: unknown;
  transforms: MappingTransformStep[];
  optional: boolean;
  hasDefault: boolean;
  defaultText: string;
  originalDefaultText?: string;
  originalDefault?: unknown;
  onNull: MappingOnNull;
}

interface EditorState {
  rows: EditorRow[];
  method: string | null;
  path: string | null;
  sections: MappingRequestSection[];
}

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

function blankRow(
  target: string,
  section: MappingRequestSection,
  required: boolean,
  fromSchema: boolean
): EditorRow {
  return {
    id: nextRowId(),
    target,
    section,
    required,
    fromSchema,
    kind: "selector",
    text: "",
    transforms: [],
    optional: false,
    hasDefault: false,
    defaultText: "",
    onNull: "PASS",
  };
}

function editorRow(
  model: MappingResponseRow,
  section: MappingRequestSection,
  required: boolean,
  fromSchema: boolean
): EditorRow {
  const constant = model.source.kind === "constant";
  const value = model.source.kind === "constant" ? model.source.value : null;
  const text = constant ? literal(value) : model.source.kind === "selector" ? model.source.selector : "";
  const hasDefault = "default" in model && model.default !== undefined;
  const defaultText = hasDefault ? literal(model.default) : "";
  return {
    id: nextRowId(),
    target: model.target,
    section,
    required,
    fromSchema,
    kind: constant ? "constant" : "selector",
    text,
    ...(constant ? { originalText: text, originalValue: value } : {}),
    transforms: model.transforms,
    optional: model.optional,
    hasDefault,
    defaultText,
    ...(hasDefault ? { originalDefaultText: defaultText, originalDefault: model.default } : {}),
    onNull: model.onNull,
  };
}

/** A row is written into the document when it has something to write. */
function isPresent(row: EditorRow): boolean {
  if (row.target.trim() === "") return false;
  return row.kind === "constant" || row.text.trim() !== "";
}

/**
 * What is wrong with this row, in the provider's words, or `null`.
 *
 * The rule this covers is the one `canExpressAsRows` cannot: a half-filled row
 * is simply **not written**, and the round trip still compares equal because
 * the key was never there to compare. So a provider who clears a selector to
 * retype it and saves mid-thought loses the key, silently — the same failure
 * the `$from` refusal exists to prevent, arriving through the other door.
 *
 * A schema row with no selector is exempt: it is the empty row the tool's
 * contract asked for, and leaving an optional output field unmapped is a
 * legitimate mapping, not a half-typed one.
 */
function rowProblem(row: EditorRow): string | null {
  const target = row.target.trim();
  if (target === "") return "a row has no name, so it would not be written";
  if (row.kind === "selector" && row.text.trim() === "" && !row.fromSchema) {
    return `${target} has no selector, so it would be dropped rather than saved`;
  }
  return null;
}

function valueOf(text: string, originalText: string | undefined, originalValue: unknown): unknown {
  if (originalText !== undefined && text === originalText) return originalValue;
  return parseLiteral(text);
}

function modelRowOf(row: EditorRow): MappingResponseRow {
  const source: MappingRowSource =
    row.kind === "constant"
      ? { kind: "constant", value: valueOf(row.text, row.originalText, row.originalValue) }
      : { kind: "selector", selector: row.text.trim() };
  const model: MappingResponseRow = {
    target: row.target.trim(),
    source,
    transforms: row.transforms,
    optional: row.optional,
    onNull: row.onNull,
  };
  if (row.hasDefault) {
    model.default = valueOf(row.defaultText, row.originalDefaultText, row.originalDefault);
  }
  return model;
}

/** The canonical document these rows describe — always through `fromRows`. */
function documentOf(state: EditorState, direction: MappingDirection): ToolMapping {
  const live = state.rows.filter(isPresent);
  if (direction === "RESPONSE") {
    return fromRows({ direction: "RESPONSE", rows: live.map(modelRowOf) });
  }
  return fromRows({
    direction: "REQUEST",
    method: state.method,
    path: state.path,
    sections: state.sections,
    rows: live.map((row) => ({ ...modelRowOf(row), section: row.section })),
  });
}

// ── Opening a document ─────────────────────────────────────────────────────

interface Opened {
  state: EditorState | null;
  /** Why the table is refused, as a plain sentence. `null` when it is offered. */
  refusal: string | null;
}

function refusalSentence(error: MappingNotExpressibleError): string {
  if (error.message.includes("$from")) {
    return "this mapping projects a collection; the table cannot express `$from`";
  }
  return `the table cannot hold this document — ${error.message}`;
}

function openDocument(
  mapping: ToolMapping,
  direction: MappingDirection,
  fields: SchemaField[]
): Opened {
  if (!isObject(mapping)) {
    return { state: null, refusal: "this mapping is not a JSON object, so it has no rows" };
  }

  let model: MappingRowModel;
  try {
    // `canExpressAsRows` already swallows this throw; catching it here as well
    // is a deliberate second guard, and it is what carries the reason.
    model = toRows(mapping, direction);
  } catch (error) {
    return {
      state: null,
      refusal:
        error instanceof MappingNotExpressibleError
          ? refusalSentence(error)
          : "this mapping could not be read as rows",
    };
  }

  if (!canExpressAsRows(mapping, direction)) {
    return {
      state: null,
      refusal:
        'the table would rewrite this document rather than reproduce it — it spells out a key the row columns leave implicit (an explicit "$optional": false, an "$onNull": "PASS", or a leaf still in shorthand)',
    };
  }

  if (model.direction === "RESPONSE") {
    const remaining = new Map(model.rows.map((row) => [row.target, row] as const));
    const rows: EditorRow[] = [];
    for (const field of fields) {
      const found = remaining.get(field.name);
      remaining.delete(field.name);
      rows.push(
        found
          ? editorRow(found, "body", field.required, true)
          : blankRow(field.name, "body", field.required, true)
      );
    }
    // Whatever the document writes that the schema does not name — a nested
    // target, or a field the tool dropped. Never discarded.
    for (const row of model.rows) {
      if (!remaining.has(row.target)) continue;
      remaining.delete(row.target);
      rows.push(editorRow(row, "body", false, false));
    }
    return { state: { rows, method: null, path: null, sections: [] }, refusal: null };
  }

  return {
    state: {
      rows: model.rows.map((row) => editorRow(row, row.section, false, false)),
      method: model.method,
      path: model.path,
      sections: model.sections,
    },
    refusal: null,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

interface Validation {
  result: ValidateMappingResponse | null;
  error: ApiError | null;
  pending: boolean;
}

/**
 * `POST /validate-mapping` on a debounce — the same functions Save runs, so a
 * provider learns what will be stored before they store it.
 *
 * Keyed on the serialised document: an edit that produces the same document
 * (retyping a character back) does not re-ask, and an answer that arrives
 * after the document moved on is discarded rather than shown against it.
 */
function useValidation(
  toolId: string,
  direction: MappingDirection,
  mapping: ToolMapping | null
): Validation {
  const [result, setResult] = React.useState<ValidateMappingResponse | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [pending, setPending] = React.useState(false);

  const key = mapping ? JSON.stringify(mapping) : null;

  React.useEffect(() => {
    if (key === null) {
      setResult(null);
      setError(null);
      setPending(false);
      return;
    }
    let live = true;
    setPending(true);
    const timer = setTimeout(() => {
      validateToolMapping({ toolId, direction, mapping: JSON.parse(key) as ToolMapping })
        .then((answer) => {
          if (!live) return;
          setResult(answer);
          setError(null);
        })
        .catch((thrown: unknown) => {
          if (!live) return;
          setResult(null);
          setError(
            thrown instanceof ApiError
              ? thrown
              : new ApiError("UNKNOWN", "The validator could not be reached.", 0)
          );
        })
        .finally(() => {
          if (live) setPending(false);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, toolId, direction]);

  return { result, error, pending };
}

// ── Cell chrome ────────────────────────────────────────────────────────────

/**
 * An input that lives in a table cell.
 *
 * Same treatment as the constraints form's `CeilingInput`: invisible at rest,
 * a border under the pointer and on focus. A focus **ring** would be clipped
 * by the cell, so the affordance is a border, which sits inside the box.
 */
function CellInput({
  label,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <input
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      spellCheck={false}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-mono-13 text-02 outline-none",
        "hover:border-02 focus:border-primary-500 focus:text-01 placeholder:text-03",
        // `focus:` beats a bare class whatever the order, so the invalid
        // border has to be restated as a focus variant — otherwise the red
        // disappears in the one cell the provider is actually typing in.
        invalid && "border-danger-500 text-danger-500 focus:border-danger-500"
      )}
    />
  );
}

function chainLabel(row: EditorRow): string {
  if (row.kind === "constant") return "constant";
  if (row.transforms.length === 0) return "identity";
  return row.transforms.map(transformStepName).join(" → ");
}

// ── The per-row editor ─────────────────────────────────────────────────────

/**
 * Everything a row declares that four columns have no room for: the
 * `$path`/`$const` choice, the transform chain and its arguments, `$default`
 * and `$onNull`.
 *
 * It is one block under the table rather than an expanded row, because the
 * `Table` primitive's drill rows carry the same columns as the row above them
 * — which is right for a breakdown and wrong for a form.
 */
function RowEditor({
  row,
  direction,
  onPatch,
  onRemove,
  onClose,
}: {
  row: EditorRow;
  direction: MappingDirection;
  onPatch: (patch: Partial<EditorRow>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const setStep = (index: number, step: MappingTransformStep) =>
    onPatch({ transforms: row.transforms.map((current, at) => (at === index ? step : current)) });

  const retype = (step: MappingTransformStep, name: string): MappingTransformStep => {
    // Re-selecting the name a step already has must be a no-op. `TAKES_SEPARATOR`
    // knows only this build's two arg-taking transforms, so anything else
    // carrying arguments — a transform added to the backend registry since —
    // would have had them dropped by the rebuild below.
    if (name === transformStepName(step)) return step;
    if (TAKES_SEPARATOR.has(name)) {
      const args = transformStepArgs(step);
      const separator = typeof args?.separator === "string" ? args.separator : ",";
      return { name, args: { separator } };
    }
    // The step keeps the form it arrived in — a bare string stays a bare
    // string, an object stays an object.
    return typeof step === "string" ? name : { name, args: {} };
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-02 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-mono text-mono-13 text-01">
          {row.target.trim() === "" ? "a new field" : row.target}
        </p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
        {direction === "REQUEST" ? (
          <Select
            label="Section"
            value={row.section}
            onChange={(event) =>
              onPatch({ section: event.target.value as MappingRequestSection })
            }
            hint="where the value lands on your own request"
          >
            {SECTIONS.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          label="Source"
          value={row.kind}
          onChange={(event) => onPatch({ kind: event.target.value as "selector" | "constant" })}
          hint={
            row.kind === "selector"
              ? "$path — read a value out of the document"
              : "$const — a fixed value, never read"
          }
        >
          <option value="selector">selector ($path)</option>
          <option value="constant">constant ($const)</option>
        </Select>

        <Field
          label={row.kind === "selector" ? "Selector" : "Constant"}
          value={row.text}
          spellCheck={false}
          onChange={(event) => onPatch({ text: event.target.value })}
          placeholder={row.kind === "selector" ? "$.current.temperature_2m" : "en"}
          hint={
            row.kind === "selector"
              ? "$ is the root; $.a.b, $['a-b'] and $.items[0] address into it"
              : "a JSON literal — 10, true, null, [\"a\"]. Anything else is text."
          }
        />

        <Select
          label="$onNull"
          value={row.onNull}
          onChange={(event) => onPatch({ onNull: event.target.value as MappingOnNull })}
          hint="an explicit null in the response is not a missing field"
        >
          {NULL_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {policy}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-label-13 text-01">$transform</span>
          <span className="font-mono text-mono-12 text-03">
            each step is applied in order — a step that rejects its input fails the call as a mapping error
          </span>
        </div>
        {row.transforms.map((step, index) => {
          const name = transformStepName(step);
          const args = transformStepArgs(step);
          return (
            <div key={`${index}-${name}`} className="flex items-end gap-2">
              <Select
                label={`Step ${index + 1}`}
                value={name}
                onChange={(event) => setStep(index, retype(step, event.target.value))}
              >
                {TRANSFORMS.map((transform) => (
                  <option key={transform} value={transform}>
                    {transform}
                  </option>
                ))}
                {TRANSFORMS.includes(name) ? null : <option value={name}>{name}</option>}
              </Select>
              {TAKES_SEPARATOR.has(name) ? (
                <Field
                  label="separator"
                  wrapperClassName="w-[140px] shrink-0"
                  value={typeof args?.separator === "string" ? args.separator : ""}
                  onChange={(event) =>
                    setStep(index, { name, args: { separator: event.target.value } })
                  }
                />
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="mb-1"
                onClick={() =>
                  onPatch({ transforms: row.transforms.filter((_, at) => at !== index) })
                }
              >
                Remove
              </Button>
            </div>
          );
        })}
        <Select
          label="Add a step"
          value=""
          wrapperClassName="tablet:w-1/2"
          onChange={(event) => {
            const name = event.target.value;
            if (!name) return;
            onPatch({ transforms: [...row.transforms, retype(name, name)] });
          }}
        >
          <option value="">{EM_DASH}</option>
          {TRANSFORMS.map((transform) => (
            <option key={transform} value={transform}>
              {transform}
              {TAKES_SEPARATOR.has(transform) ? " (separator)" : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Checkbox
          checked={row.hasDefault}
          onChange={(event) => onPatch({ hasDefault: event.target.checked })}
          label={
            <span className="font-mono text-mono-12">
              declare a $default — used when the selector resolves to nothing
            </span>
          }
        />
        {row.hasDefault ? (
          <Field
            label="$default"
            value={row.defaultText}
            spellCheck={false}
            onChange={(event) => onPatch({ defaultText: event.target.value })}
            hint='a JSON literal. `null` is a real default, and is not "no default".'
          />
        ) : null}
      </div>

      {row.fromSchema ? null : (
        <div>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove this row
          </Button>
        </div>
      )}
    </div>
  );
}

// ── The editor ─────────────────────────────────────────────────────────────

/**
 * Why this editor's document must not be saved, if it must not be.
 *
 * Two kinds, because they gate differently. `editing` means the provider is
 * looking at something broken — unparseable JSON — and a save would write a
 * document they are not reading, so it blocks unconditionally. `document`
 * means this particular mapping is known-bad; it blocks only if the page is
 * actually going to send it, so a pre-existing bad mapping does not lock a
 * provider out of editing a ceiling.
 */
export interface MappingEditorStatus {
  editing: string | null;
  document: string | null;
}

export interface MappingEditorProps {
  direction: MappingDirection;
  toolId: string;
  /** The stored document this editor opens on. Remount (via `key`) to reload. */
  mapping: ToolMapping;
  /** The tool's `inputSchema` (REQUEST) or `outputSchema` (RESPONSE). */
  schema: Record<string, unknown> | undefined;
  /** The page's "Edit as JSON" switch. A refused document forces it on anyway. */
  json: boolean;
  /** The document as it now stands — emitted on every edit, and once on mount. */
  onChange: (next: ToolMapping) => void;
  /** Whether that document may be saved. Emitted on every change of answer. */
  onStatus?: (status: MappingEditorStatus) => void;
  className?: string;
}

export function MappingEditor({
  direction,
  toolId,
  mapping,
  schema,
  json,
  onChange,
  onStatus,
  className,
}: MappingEditorProps) {
  const fields = React.useMemo(() => schemaFields(schema), [schema]);
  const [opened, setOpened] = React.useState<Opened>(() =>
    openDocument(mapping, direction, direction === "RESPONSE" ? schemaFields(schema) : [])
  );
  const [jsonDoc, setJsonDoc] = React.useState<ToolMapping>(mapping);
  const [jsonText, setJsonText] = React.useState(() => JSON.stringify(mapping, null, 2));
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const [openRowId, setOpenRowId] = React.useState<string | null>(null);

  const jsonMode = json || opened.state === null;

  const tableDoc = React.useMemo(
    () => (opened.state ? documentOf(opened.state, direction) : null),
    [opened.state, direction]
  );
  const doc = jsonMode ? jsonDoc : (tableDoc ?? jsonDoc);

  /* The two modes hand the document to each other rather than each keeping
     their own: flipping to JSON serialises what the rows now say, and flipping
     back re-opens what the text now says — which may be a document the rows
     can no longer hold, in which case `openDocument` refuses and the mode
     comes straight back here. */
  const wasJson = React.useRef(jsonMode);
  /* Each side is carried across explicitly, never through `doc`. The switch
     flips before this effect runs, so by then `doc` already reads from the
     mode being *entered* — taking it would hand the rows back to the rows and
     the text back to the text, and the edit made in the other one would be
     dropped without a word. */
  const latest = React.useRef({ jsonDoc, tableDoc, direction, fields });
  latest.current = { jsonDoc, tableDoc, direction, fields };
  React.useEffect(() => {
    if (jsonMode === wasJson.current) return;
    const current = latest.current;
    if (jsonMode) {
      /*
        `tableDoc` is null when a refused switch-back bounced us straight back
        into JSON. The text on screen is then the provider's own, and it is
        what caused the refusal — re-serialising it would reformat their
        whitespace and move their cursor on a toggle that visibly did nothing.
      */
      if (current.tableDoc === null) {
        wasJson.current = true;
        return;
      }
      wasJson.current = true;
      setJsonDoc(current.tableDoc);
      setJsonText(JSON.stringify(current.tableDoc, null, 2));
      setJsonError(null);
      return;
    }
    wasJson.current = false;
    setOpened(
      openDocument(
        current.jsonDoc,
        current.direction,
        current.direction === "RESPONSE" ? current.fields : []
      )
    );
  }, [jsonMode]);

  /* The page owns the draft, so every document this editor settles on is
     handed up — including the one it opened with, which lets the page compare
     against the stored mapping and send nothing when they agree. */
  const emit = React.useRef(onChange);
  emit.current = onChange;
  React.useEffect(() => {
    emit.current(doc);
  }, [doc]);

  const validation = useValidation(toolId, direction, jsonError ? null : doc);

  const patchState = (next: (state: EditorState) => EditorState) =>
    setOpened((current) =>
      current.state ? { ...current, state: next(current.state) } : current
    );

  const patchRow = (id: string, patch: Partial<EditorRow>) =>
    patchState((state) => ({
      ...state,
      rows: state.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));

  const addRow = () => {
    const row = blankRow("", direction === "REQUEST" ? "query" : "body", false, false);
    patchState((state) => ({ ...state, rows: [...state.rows, row] }));
    setOpenRowId(row.id);
  };

  const removeRow = (id: string) =>
    patchState((state) => ({ ...state, rows: state.rows.filter((row) => row.id !== id) }));

  const rows = opened.state?.rows ?? [];
  const openRow = rows.find((row) => row.id === openRowId) ?? null;

  const optionalAtRequired = rows.filter(
    (row) => row.required && isPresent(row) && row.optional && !row.hasDefault
  );
  const unwritten = rows.filter((row) => row.required && !isPresent(row));
  const problems = jsonMode ? [] : rows.map(rowProblem).filter((problem) => problem !== null);

  const label = direction === "REQUEST" ? "requestMapping" : "responseMapping";

  /*
    Lifted to the page, which owns Save. Neither of these reaches it any other
    way: `doc` falls back to the last document that parsed, so a red parse
    error on screen still leaves a perfectly sendable object behind it, and the
    validator's refusal lives entirely inside this component.
  */
  const status: MappingEditorStatus = {
    editing: jsonError ? `the ${label} JSON does not parse` : null,
    document: validation.error
      ? `${label}: ${validation.error.code}`
      : (problems[0] ?? null),
  };
  const report = React.useRef(onStatus);
  report.current = onStatus;
  React.useEffect(() => {
    report.current?.({ editing: status.editing, document: status.document });
  }, [status.editing, status.document]);

  /* --------------------------------------------------------------- columns */

  const optionalCell = (row: EditorRow) => (
    <span className="flex w-full items-center justify-end gap-2">
      <Checkbox
        // The visible word is the format's key; the accessible name has to
        // name the row as well, or a screen reader reads out one "optional"
        // per field with nothing to tell them apart. Same for the chain
        // button below, and the gear beside it.
        aria-label={`$optional — ${row.target.trim() || "the new row"}`}
        checked={row.optional}
        onChange={(event) => patchRow(row.id, { optional: event.target.checked })}
        label={
          <span
            className={cn(
              "font-mono text-mono-12",
              row.required && row.optional && !row.hasDefault && "text-danger-500"
            )}
          >
            optional
          </span>
        }
      />
      <button
        type="button"
        aria-label={`Edit ${row.target.trim() || "the new row"}`}
        aria-pressed={openRowId === row.id}
        onClick={() => setOpenRowId((current) => (current === row.id ? null : row.id))}
        className={cn(
          "flex size-[22px] shrink-0 items-center justify-center rounded-sm text-03",
          "hover:bg-02 hover:text-01 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500",
          openRowId === row.id && "bg-02 text-01"
        )}
      >
        <SlidersHorizontal width={14} height={14} aria-hidden="true" />
      </button>
    </span>
  );

  const transformCell = (row: EditorRow) => (
    <button
      type="button"
      aria-label={`Transform chain — ${row.target.trim() || "the new row"}`}
      onClick={() => setOpenRowId((current) => (current === row.id ? null : row.id))}
      className="min-w-0 truncate rounded-sm px-1 font-mono text-mono-13 text-02 hover:text-01 hover:underline"
    >
      {chainLabel(row)}
    </button>
  );

  const requestColumns: TableColumn<EditorRow>[] = [
    {
      key: "toolField",
      header: "Tool field",
      mono: true,
      noTruncate: true,
      cell: (row) => (
        <CellInput
          label={`Tool field for ${row.target.trim() || "the new row"}`}
          value={row.text}
          onChange={(next) => patchRow(row.id, { text: next })}
          placeholder={row.kind === "constant" ? "a constant" : "$.latitude"}
          invalid={row.kind === "selector" && row.text.trim() === "" && !row.fromSchema}
        />
      ),
    },
    {
      key: "transform",
      header: "Transform",
      width: 150,
      noTruncate: true,
      cell: transformCell,
    },
    {
      key: "upstream",
      header: "Upstream field",
      width: 240,
      noTruncate: true,
      cell: (row) => (
        <span className="flex w-full items-center gap-1.5">
          <span className="shrink-0 font-mono text-mono-12 text-03">
            {row.section === "headers" ? "header" : row.section}
          </span>
          <CellInput
            label={`Upstream field in ${row.section}`}
            value={row.target}
            onChange={(next) => patchRow(row.id, { target: next })}
            placeholder="latitude"
            invalid={row.target.trim() === ""}
          />
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 168,
      align: "end",
      noTruncate: true,
      cell: optionalCell,
    },
  ];

  const responseColumns: TableColumn<EditorRow>[] = [
    {
      key: "outputField",
      header: "Output field",
      width: 220,
      // `Table` right-aligns any column that names a width, which is right for
      // a figure and wrong for the row's own label — the request table's first
      // column flexes and reads from the left, and these two sit side by side.
      align: "start",
      mono: true,
      noTruncate: true,
      cell: (row) =>
        row.fromSchema ? (
          <span className="flex w-full items-center gap-1.5">
            <span className="truncate font-semibold text-01">{row.target}</span>
            {row.required ? (
              <span className="shrink-0 font-mono text-mono-12 text-warning-600">required</span>
            ) : null}
          </span>
        ) : (
          <CellInput
            label="Output field"
            value={row.target}
            onChange={(next) => patchRow(row.id, { target: next })}
            placeholder="a field the schema does not name"
            invalid={row.target.trim() === ""}
          />
        ),
    },
    {
      key: "from",
      header: "From",
      noTruncate: true,
      cell: (row) => (
        <span className="flex w-full items-center gap-1.5">
          <CellInput
            label={`From, for ${row.target.trim() || "the new row"}`}
            value={row.text}
            onChange={(next) => patchRow(row.id, { text: next })}
            placeholder={row.kind === "constant" ? "a constant" : "$.current.temperature_2m"}
            invalid={row.kind === "selector" && row.text.trim() === "" && !row.fromSchema}
          />
          <span className="shrink-0 font-mono text-mono-12 text-03">{chainLabel(row)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 168,
      align: "end",
      noTruncate: true,
      cell: optionalCell,
    },
  ];

  /* ------------------------------------------------------------------ JSON */

  const onJsonEdit = (next: string) => {
    setJsonText(next);
    let parsed: unknown;
    try {
      parsed = JSON.parse(next) as unknown;
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "This is not JSON.");
      return;
    }
    if (!isObject(parsed)) {
      setJsonError("A mapping is a JSON object.");
      return;
    }
    setJsonError(null);
    setJsonDoc(parsed);
    /*
      Without this the refusal latches for the rest of the mount: `jsonMode` is
      `json || opened.state === null`, and the only reopen lives behind
      `if (!jsonMode)`, which a refusal makes unreachable. So a provider who
      pastes a `$from`, sees the table go, and then deletes it again would need
      a save or a reload to get the table back, with nothing on screen saying
      so. The moment the text is expressible again, the rows come back.
    */
    setOpened((current) => {
      if (current.state !== null) return current;
      if (!canExpressAsRows(parsed, direction)) return current;
      return openDocument(parsed, direction, direction === "RESPONSE" ? fields : []);
    });
  };

  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      {jsonMode ? (
        <>
          {opened.refusal ? (
            <p className="px-1 text-body-13 text-02">
              This mapping is edited as JSON: {opened.refusal}.
            </p>
          ) : null}
          <textarea
            aria-label={`${label} as JSON`}
            spellCheck={false}
            value={jsonText}
            onChange={(event) => onJsonEdit(event.target.value)}
            className={cn(
              "min-h-[320px] w-full rounded-md border border-02 bg-01 px-3 py-2.5 font-mono text-mono-12 text-01 outline-none",
              "focus:border-primary-500",
              jsonError && "border-danger-500"
            )}
          />
          {jsonError ? (
            <p role="alert" className="px-1 text-body-13 text-danger-500">
              {jsonError}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {direction === "REQUEST" && opened.state ? (
            <div className="grid grid-cols-1 gap-3 px-1 tablet:grid-cols-[160px_1fr]">
              <Select
                label="method"
                value={opened.state.method ?? ""}
                onChange={(event) =>
                  patchState((state) => ({ ...state, method: event.target.value || null }))
                }
              >
                <option value="">{EM_DASH}</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </Select>
              <Field
                label="path"
                value={opened.state.path ?? ""}
                spellCheck={false}
                onChange={(event) =>
                  patchState((state) => ({ ...state, path: event.target.value || null }))
                }
                placeholder="/v1/cities/{$.cityId}/now"
                hint="appended to the endpoint. {$.selector} segments interpolate, URL-encoded."
              />
            </div>
          ) : null}

          <Table
            columns={direction === "REQUEST" ? requestColumns : responseColumns}
            rows={rows}
            caption={`${label} rows`}
          />

          <div className="flex items-center justify-between gap-3 px-1">
            <p className="font-mono text-mono-12 text-03">
              {direction === "REQUEST"
                ? fields.length > 0
                  ? `readable: ${fields
                      .map((field) => `$.${field.name}${field.required ? "" : "?"}`)
                      .join(" · ")}`
                  : "this tool takes no input, so every value here is a constant"
                : `${rows.filter(isPresent).length} of ${rows.length} fields mapped`}
            </p>
            <Button variant="secondary" size="sm" icon={<Plus aria-hidden="true" />} onClick={addRow}>
              {direction === "REQUEST" ? "Add a parameter" : "Add a field"}
            </Button>
          </div>

          {openRow ? (
            <RowEditor
              row={openRow}
              direction={direction}
              onPatch={(patch) => patchRow(openRow.id, patch)}
              onRemove={() => {
                removeRow(openRow.id);
                setOpenRowId(null);
              }}
              onClose={() => setOpenRowId(null)}
            />
          ) : null}

          <p className="px-1 text-body-13 text-02">
            <span className="font-mono text-mono-12 text-01">$optional</span> is a declaration,
            never an inference: it says the field may legitimately be absent, so it is left out of the document instead of failing the call as a missing path.
          </p>

          {optionalAtRequired.length > 0 ? (
            <p role="alert" className="px-1 text-body-13 text-danger-500">
              {optionalAtRequired.map((row) => row.target).join(", ")} —{" "}
              {optionalAtRequired.length === 1 ? "this field is" : "these fields are"}{" "}
              required by the tool&rsquo;s outputSchema, so $optional needs a $default beside it. Without one
              the save is refused: a required field that may be omitted is a document that may
              legally be invalid.
            </p>
          ) : null}

          {problems.length > 0 ? (
            <p role="alert" className="px-1 text-body-13 text-danger-500">
              {problems[0]}. A half-filled row is not written at all, so it is
              refused here rather than saved as a missing key.
            </p>
          ) : null}

          {unwritten.length > 0 ? (
            <p role="alert" className="px-1 text-body-13 text-danger-500">
              {unwritten.map((row) => row.target).join(", ")} —{" "}
              {unwritten.length === 1 ? "this field is" : "these fields are"}{" "}
              required and nothing writes {unwritten.length === 1 ? "it" : "them"} yet, so no response can satisfy the
              contract.
            </p>
          ) : null}
        </>
      )}

      {validation.error ? (
        <p role="alert" className="px-1 text-body-13 text-danger-500">
          {validation.error.code} — {validation.error.message}
        </p>
      ) : validation.result ? (
        <>
          <CodeBlock
            title={`canonical · ${label}`}
            code={JSON.stringify(validation.result.canonical, null, 2)}
          />
          <p className="px-1 font-mono text-mono-12 text-03">
            selectors{" "}
            {validation.result.selectors.length > 0
              ? validation.result.selectors.join(" · ")
              : EM_DASH}{" "}
            · transforms{" "}
            {validation.result.transforms.length > 0
              ? validation.result.transforms.join(" · ")
              : EM_DASH}
          </p>
        </>
      ) : validation.pending ? (
        <p className="px-1 font-mono text-mono-12 text-03">checking this mapping…</p>
      ) : null}
    </div>
  );
}
