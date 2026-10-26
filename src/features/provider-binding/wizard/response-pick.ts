import type { BindingTestReport, ToolMapping } from "@/interfaces";

import { isObject, leafOf } from "../mapping-model";

/**
 * Click a value in your API's real answer to fill an output field
 * (onboarding wave 2, item 3). The provider never types JSONPath: the path is
 * built here from where they clicked, in the backend's selector dialect
 * (assay-backend `tool/domain/mapping/json-path.ts`): `$.a.b`, `$['a b']`,
 * `$.items[0]`. The Advanced mapping editor stays for everything else.
 */

export type PathStep = string | number;

/** A member name `$.name` can spell: the backend reads a dotted name up to the next `.` or `[`. */
const DOTTED = /^[A-Za-z0-9_$-]+$/;

/** The selector for a place in the answer, or null when the dialect cannot spell a key there. */
export function jsonPathFor(steps: readonly PathStep[]): string | null {
  let path = "$";
  for (const step of steps) {
    if (typeof step === "number") {
      path += `[${step}]`;
    } else if (DOTTED.test(step)) {
      path += `.${step}`;
    } else if (step.length > 0 && !step.includes("]") && !step.includes("'")) {
      path += `['${step}']`;
    } else if (step.length > 0 && !step.includes("]") && !step.includes('"')) {
      path += `["${step}"]`;
    } else {
      // The dialect has no escapes: a key with `]` (or both quotes) cannot be selected.
      return null;
    }
  }
  return path;
}

/**
 * The JSON body of the latest test's answer, or null when there is none to
 * show: no answer, a cut-off one (it would not parse), or not JSON.
 */
export function sampleAnswer(report: Pick<BindingTestReport, "upstream"> | null | undefined): unknown {
  const raw = report?.upstream?.rawBody;
  if (!raw || report?.upstream?.rawBodyTruncated) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether picking can write this response mapping: a plain field-by-field document, not a `$from` projection. */
export function canPickInto(mapping: ToolMapping): boolean {
  return !("$from" in mapping) && !("$path" in mapping) && !("$const" in mapping);
}

/** The selector an output field reads today, if it reads one. */
export function pickedPath(mapping: ToolMapping, field: string): string | null {
  if (!(field in mapping)) return null;
  return leafOf(mapping[field]).selector;
}

/**
 * The mapping with `field` reading `path`. A canonical `{ "$path" }` leaf; a
 * leaf that already had options (`$optional`, a default, transforms) keeps
 * them and only its path moves.
 */
export function pickInto(mapping: ToolMapping, field: string, path: string): ToolMapping {
  const current = mapping[field];
  const next = isObject(current) && !("$const" in current) ? { ...current, $path: path } : { $path: path };
  return { ...mapping, [field]: next };
}

/** One row of the answer as a tree: where it is, what it is, how deep. */
export interface AnswerNode {
  steps: PathStep[];
  path: string | null;
  label: string;
  /** The value as short text, for a leaf; a count for an object or a list. */
  preview: string;
  leaf: boolean;
  depth: number;
}

const MAX_NODES = 300;
const MAX_ITEMS = 5;

/** The answer flattened into rows, in reading order; long lists show their first few items. */
export function answerNodes(value: unknown): AnswerNode[] {
  const out: AnswerNode[] = [];
  const walk = (node: unknown, steps: PathStep[], depth: number) => {
    if (out.length >= MAX_NODES) return;
    const entries: [PathStep, unknown][] = Array.isArray(node)
      ? node.slice(0, MAX_ITEMS).map((item, index) => [index, item])
      : isObject(node)
        ? Object.entries(node)
        : [];
    for (const [step, child] of entries) {
      if (out.length >= MAX_NODES) return;
      const here = [...steps, step];
      const container = typeof child === "object" && child !== null;
      out.push({
        steps: here,
        path: jsonPathFor(here),
        label: typeof step === "number" ? `[${step}]` : step,
        preview: container
          ? Array.isArray(child)
            ? `list of ${child.length}`
            : `${Object.keys(child).length} field${Object.keys(child).length === 1 ? "" : "s"}`
          : JSON.stringify(child),
        leaf: !container,
        depth,
      });
      if (container) walk(child, here, depth + 1);
    }
  };
  walk(value, [], 0);
  return out;
}
