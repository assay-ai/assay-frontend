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

/**
 * The window a link asked for (`/spend?range=24h`, or `?window=7d`), or
 * `null` when it names none this page offers.
 */
export function windowIdFromQuery(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    const id = value?.trim().toLowerCase();
    if (id && SPEND_WINDOWS.some((w) => w.id === id)) return id;
  }
  return null;
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
 * `agent` groups by `payment_intents.agent_id`, the agent whose credential
 * made the call, so a call an agent paid for with its own delegate key lands
 * under that agent. Verdict and status are not groupings a person asks for —
 * they are Calls filters — so Spend offers tool, agent and provider only.
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
  { id: "tool", label: "Tool", header: "Tool" },
  { id: "agent", label: "Agent", header: "Agent" },
  { id: "provider", label: "Provider", header: "Provider" },
];

export function dimensionById(id: string): SpendDimension {
  return SPEND_DIMENSIONS.find((d) => d.id === id) ?? SPEND_DIMENSIONS[0];
}

/**
 * Group keys are ids for `tool`/`provider`/`agent` and already human for the
 * rest. An agent id is named from `GET /agents` when the caller passes its labels.
 * There is no endpoint that resolves a tool id to `scrape_url`, so an id is
 * shortened rather than invented.
 *
 * The `verdict` dimension is the sharp one: its group keys ARE the raw internal
 * verdict tokens (PASS, FAIL, UNVERIFIED, …), and the design system forbids
 * one of those reaching the screen. They go through `presentVerdict()` like
 * every other verdict on this product, which is also why three of the labels
 * this can produce are `provisional` wordings.
 */
export function groupKeyLabel(
  key: string,
  dimension: string,
  agentLabels?: ReadonlyMap<string, string>,
): string {
  if (dimension === "agent") {
    const label = agentLabels?.get(key);
    if (label) return label;
    // A row from before calls named their credential: keyed by its agent.
    if (key.startsWith(AGENT_KEY_PREFIX)) key = key.slice(AGENT_KEY_PREFIX.length);
  }
  if (dimension === "tool" || dimension === "provider" || dimension === "agent") {
    return key.length > 12 ? `${key.slice(0, 8)}…` : key;
  }
  if (dimension === "verdict") {
    return presentVerdict(key).shownAs;
  }
  return key;
}

/** How a `groupBy=credential` row with no credential (written before the column) is keyed. */
export const AGENT_KEY_PREFIX = "agent:";

/**
 * The `groupBy` the summary is asked for, per dimension (U02). "Agent" means
 * the agent credential that paid: two credentials of one agent hold two
 * delegate keys (two machines), and grouping by `agent_id` made them one row.
 */
export function summaryGroupBy(dimension: string): string {
  return dimension === "agent" ? "credential" : dimension;
}

/**
 * Labels for `groupBy=credential` keys: "agent label · credential name" by
 * credential id, and the agent label alone for `agent:<id>` keys.
 */
export function credentialGroupLabels(
  agents: readonly { agentId: string; label?: string | null }[],
  credentialsByAgent: Readonly<Record<string, readonly { id: string; name?: string | null }[]>>,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const agent of agents) {
    const agentLabel = agent.label || agent.agentId;
    labels.set(agent.agentId, agentLabel);
    labels.set(`${AGENT_KEY_PREFIX}${agent.agentId}`, agentLabel);
    for (const credential of credentialsByAgent[agent.agentId] ?? []) {
      labels.set(credential.id, credential.name ? `${agentLabel} · ${credential.name}` : agentLabel);
    }
  }
  return labels;
}
