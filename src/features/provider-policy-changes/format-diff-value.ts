import { DASH } from "@/features/g34a/stats";

/**
 * One diff cell's value, as text.
 *
 * `PolicyDiffEntry.before`/`.after` are `unknown` — whatever sat at that path
 * in `decision_document`, which can be a primitive, an object (a whole
 * verifier or rule clause) or an array. `undefined` is the entry's own way of
 * saying "this side had nothing here" (`changeType` is `"added"` or
 * `"removed"`), which is a different fact from the path holding a JSON
 * `null` — so the two render differently: `undefined` is `DASH`, JSON `null`
 * is the literal `null`.
 */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return DASH;
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
