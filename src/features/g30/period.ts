import { presentVerdict } from "@/utils/verdict";

/**
 * The window and the comparison basis the Spend explorer runs on.
 *
 * The design draws two chips — "Window: Last night · 18:00–06:00" and
 * "Compare to: previous 12h" — both with a chevron. The wire only accepts
 * `compareTo=previous_period`, so the comparison is DERIVED from the window
 * rather than chosen: picking "Last 7 days" makes the comparison "previous 7
 * days" and there is nothing else it could be.
 */

export interface SpendWindow {
  id: string;
  /** Chip value, e.g. "Last 7 days". */
  label: string;
  /** The comparison chip's value, e.g. "previous 7 days". */
  compareLabel: string;
  hours: number;
}

export const SPEND_WINDOWS: SpendWindow[] = [
  { id: "24h", label: "Last 24 hours", compareLabel: "previous 24h", hours: 24 },
  { id: "7d", label: "Last 7 days", compareLabel: "previous 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", compareLabel: "previous 30 days", hours: 24 * 30 },
];

export const DEFAULT_WINDOW_ID = "7d";

export function windowById(id: string): SpendWindow {
  return SPEND_WINDOWS.find((w) => w.id === id) ?? SPEND_WINDOWS[1];
}

/** `from` is inclusive, `to` exclusive — the API's own words. */
export function windowRange(win: SpendWindow, now = Date.now()): { from: string; to: string } {
  return {
    from: new Date(now - win.hours * 3_600_000).toISOString(),
    to: new Date(now).toISOString(),
  };
}

/**
 * The dimensions the Group-by control offers.
 *
 * `agent` is drawn disabled in the design and stays disabled: nothing on the
 * wire groups by agent. The design's third segment reads "hour"; the wire's
 * `groupBy` enum has `day` and no finer grain, so this build offers `day` under
 * the design's own "upstream/hour" vocabulary. Reported as a divergence.
 */
export interface SpendDimension {
  id: "tool" | "provider" | "day" | "status" | "verdict" | "agent";
  /** The word the design uses, which is not always the wire's word. */
  label: string;
  /** Column header for the label column when grouping by this dimension. */
  header: string;
  disabled?: boolean;
}

export const SPEND_DIMENSIONS: SpendDimension[] = [
  { id: "tool", label: "tool", header: "Tool" },
  { id: "provider", label: "upstream", header: "Upstream" },
  { id: "day", label: "day", header: "Day" },
  { id: "status", label: "status", header: "Status" },
  { id: "verdict", label: "verdict", header: "Verdict" },
  { id: "agent", label: "agent", header: "Agent", disabled: true },
];

export function dimensionById(id: string): SpendDimension {
  return SPEND_DIMENSIONS.find((d) => d.id === id) ?? SPEND_DIMENSIONS[0];
}

/**
 * Group keys are ids for `tool`/`provider` and already human for the rest.
 * There is no endpoint that resolves a tool id to `scrape_url`, so an id is
 * shortened rather than invented.
 *
 * The `verdict` dimension is the sharp one: its group keys ARE the raw internal
 * verdict tokens (PASS, FAIL, UNVERIFIED, …), and the design system forbids
 * one of those reaching the screen. They go through `presentVerdict()` like
 * every other verdict on this product, which is also why three of the labels
 * this can produce are `provisional` wordings.
 */
export function groupKeyLabel(key: string, dimension: string): string {
  if (dimension === "tool" || dimension === "provider") {
    return key.length > 12 ? `${key.slice(0, 8)}…` : key;
  }
  if (dimension === "verdict") {
    return presentVerdict(key).shownAs;
  }
  return key;
}
