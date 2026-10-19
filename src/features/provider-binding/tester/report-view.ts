/**
 * Pure readers over one `BindingTestReport`.
 *
 * Everything here is a *projection* of what `POST
 * /providers/me/tool-bindings/{id}/test` returned. Nothing re-derives a
 * verdict, re-orders a stage or re-runs a rule: the mapping tester screen's whole reason to exist
 * is that a provider can predict production from it, and a frontend that
 * computed even one of those numbers itself would be predicting the frontend
 * instead. Where the API returns nothing, these return nothing — never a
 * plausible substitute.
 *
 * `mapped`, `request.body` and the two mapping documents are genuinely
 * `unknown` (their shape is whatever the tool's schema says), so they are read
 * structurally — `key in node` guards, no casts to a shape we guessed.
 */

import type { BindingTestReport } from "@/interfaces";

/** Pretty JSON for a value whose shape is open. Never asserts a type onto it. */
export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // A cycle cannot survive the wire, but a `BigInt` could reach this from a
    // future field. Better an honest marker than a thrown render.
    return "/* value could not be serialised */";
  }
}

/** The path the tester actually built, for the pane head. Falls back to the whole url. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** `{ latitude: "52.52" }` from the url the tester reports it sent. */
export function queryOf(url: string): Record<string, string> | null {
  try {
    const parsed = new URL(url);
    const entries = [...parsed.searchParams.entries()];
    return entries.length === 0 ? null : Object.fromEntries(entries);
  } catch {
    return null;
  }
}

/** One row of the verdict table. Order is the API's, never re-sorted. */
export interface VerdictRow {
  id: string;
  /** Left column. A stage word, or a rule's type. */
  check: string;
  /** The status word plus, where the API gave one, its own detail sentence. */
  result: string;
  /** The API's own `detail`, kept apart so a long one can be surfaced in full. */
  detail: string | null;
  failed: boolean;
  /** `null` where the API reports no weight — a stage row, never a rule. */
  weight: number | null;
  /**
   * DERIVED, and the only derived number on this screen: the API returns a
   * per-rule `weight` and a per-stage `score`, but no per-rule contribution.
   * A passed rule contributes its weight and a failed one contributes zero —
   * which is the arithmetic the stage `score` already reflects, so the TOTAL
   * row below is taken from the API's `score` rather than from summing these.
   * If the two ever disagree the reader sees it, which is the point.
   */
  contribution: number | null;
}

/**
 * The run's revision against the binding's current one.
 *
 * `BindingTestReport.mappingVersion` is what the publish gate keys on, so a run
 * taken before an edit is not evidence for the revision now on screen. The
 * screen has to say so out loud — a green tester panel over a changed mapping
 * is precisely the "tuned against a lie" failure this screen exists to prevent.
 */
export function isStaleRun(report: BindingTestReport, bindingVersion: number): boolean {
  return report.mappingVersion !== bindingVersion;
}
