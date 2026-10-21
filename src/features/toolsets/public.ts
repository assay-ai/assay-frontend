import { formatCallPrice } from "@/features/explorer/explorer-text";
import type { Money } from "@/interfaces";
import type { PublicToolsetCard, PublicToolsetEntry, PublicToolsetStats } from "@/services/public-toolsets.service";
import type { PublicTool } from "@/services/public-explorer.service";
import type { Figure, PublicFigures } from "@/services/toolsets.service";
import { toDecimal } from "@/utils/money";

import { BADGE_LABELS } from "./labels";

/**
 * Public tool sets: cards, trust facts and weekly figures (design spec §7.8,
 * §7.10 "Catalogue"). Cards carry tool ids, never prices, so the price range
 * and "No backup provider" are joined here from the public catalogue; "Not
 * reviewed" and "Routes to the publisher's own provider" come from the server. Figures
 * arrive rounded and k-checked; a withheld one says "Fewer than 5", never 0.
 */

export function badgeLabel(badge: string): string {
  return BADGE_LABELS[badge] ?? "Community";
}

/** "$0.001–$0.01 a call", "Free", "$0.002 a call"; null when no tool is priced yet. */
export function priceRangeText(tools: readonly Pick<PublicTool, "fromPrice" | "price" | "pricingMode" | "routable">[]): string | null {
  const routable = tools.filter((t) => t.routable);
  if (routable.length === 0) return null;
  const paid: Money[] = [];
  for (const t of routable) {
    for (const m of [t.fromPrice, t.price]) if (m && !toDecimal(m).isZero()) paid.push(m);
  }
  const free = routable.some((t) => t.pricingMode === "FREE" || t.pricingMode === "FREEMIUM");
  if (paid.length === 0) return free ? "Free" : null;
  const asset = paid[0]!.asset;
  const same = paid.filter((m) => m.asset === asset);
  const min = same.reduce((a, b) => (toDecimal(b).lt(toDecimal(a)) ? b : a));
  const max = same.reduce((a, b) => (toDecimal(b).gt(toDecimal(a)) ? b : a));
  const range = toDecimal(min).eq(toDecimal(max)) ? formatCallPrice(min) : `${formatCallPrice(min)}–${formatCallPrice(max)}`;
  return `${free ? "Free calls, then " : ""}${range} a call`;
}

export interface TrustFacts {
  priceRange: string | null;
  /** Tools with no provider or only one: if it is down, the call fails. */
  noBackup: string[];
  /** True only when every tool is known to have two or more providers. */
  allBackedUp: boolean;
  /** One maker's own tools, not reviewed by Assay (the server's `notReviewed`). */
  notReviewed: string[];
  /** Tools no longer served. */
  removed: string[];
  routesToPublisher: boolean;
}

/** The facts shown above Connect on a tool set's page and as chips on its card. */
export function trustFacts(
  card: Pick<PublicToolsetCard, "toolIds"> & { routesToPublisher?: boolean; entries?: PublicToolsetEntry[] },
  catalogue: readonly PublicTool[],
): TrustFacts {
  const byId = new Map(catalogue.map((t) => [t.id, t]));
  const tools = card.toolIds.map((id) => byId.get(id)).filter((t): t is PublicTool => Boolean(t));
  const nameOf = (id: string) => card.entries?.find((e) => e.toolId === id)?.toolName ?? byId.get(id)?.name ?? id;
  const entryOf = (id: string) => card.entries?.find((e) => e.toolId === id);
  const removed = (card.entries ?? []).filter((e) => e.removed).map((e) => e.toolName);
  // How many providers serve each tool; a tool missing from the catalogue is
  // read from the set's own entry, and counts as 0 when nothing says otherwise.
  const providersOf = (id: string): number | null => {
    const tool = byId.get(id);
    const entry = entryOf(id);
    // Removed tools and a maker's own API have their own lines.
    if (entry?.removed || entry?.notReviewed) return null;
    if (!tool) return entry ? entry.providerCount : null;
    // An "Only these" rule with one provider leaves no backup either.
    return entry && entry.providerMode === "ONLY" ? Math.min(entry.providerCount, tool.providerCount) : tool.providerCount;
  };
  const counts = card.toolIds.map((id) => ({ id, providers: providersOf(id) }));
  const noBackup = counts.filter((c) => c.providers !== null && c.providers <= 1).map((c) => c.id);
  const allBackedUp = counts.length > 0 && counts.every((c) => c.providers !== null && c.providers >= 2);
  const notReviewed = (card.entries ?? []).filter((e) => e.notReviewed && !e.removed).map((e) => e.toolId);
  return {
    priceRange: priceRangeText(tools),
    noBackup: noBackup.map(nameOf),
    allBackedUp,
    notReviewed: notReviewed.map(nameOf),
    removed,
    routesToPublisher: Boolean(card.routesToPublisher),
  };
}

/** "Fewer than 5 users", "35 users", "New" (no weekly figures yet). */
export function activeUsersText(figure: Figure | null | undefined): string {
  if (!figure) return "New";
  if (figure.value === null) return `${figure.display} users`;
  return `${figure.display} user${figure.value === 1 ? "" : "s"}`;
}

const TREND_TEXT = { UP: "↑ Growing", DOWN: "↓ Shrinking", FLAT: "→ Steady" } as const;

export interface StatRow {
  label: string;
  value: string;
  /** Explains a withheld value. */
  note?: string;
}

/**
 * The weekly figures, one row each. A figure the server withheld is either
 * left out (agents, calls, trend: they show only from 5 users) or printed as
 * the server spelt it ("Fewer than 5"); a number is never made up.
 */
export function statRows(stats: Pick<PublicToolsetStats, "activeUsers" | "agents" | "calls30d" | "copies" | "trend" | "onLatestVersionPercent"> | PublicFigures | null): StatRow[] {
  if (!stats || !stats.activeUsers) return [];
  const rows: StatRow[] = [];
  const few = stats.activeUsers.value === null;
  rows.push({
    label: "Active users (30 days)",
    value: stats.activeUsers.display,
    note: few ? "Figures stay hidden until at least 5 teams use it, so nobody can be singled out." : undefined,
  });
  if (stats.agents) rows.push({ label: "Agents", value: stats.agents.display });
  if (stats.calls30d) rows.push({ label: "Calls (30 days)", value: stats.calls30d.display });
  if (stats.copies) rows.push({ label: "Own versions made", value: stats.copies.display });
  if (stats.trend) rows.push({ label: "Trend", value: TREND_TEXT[stats.trend] });
  if (stats.onLatestVersionPercent !== null && stats.onLatestVersionPercent !== undefined) {
    rows.push({ label: "On the latest version", value: `${stats.onLatestVersionPercent}%` });
  }
  return rows;
}

/** The query a card list asks for, from the tab's controls. */
export interface CatalogueToolsetFilters {
  q: string;
  category: string | null;
  publisher: "official" | "provider" | "community" | null;
  sort: "popular" | "trending" | "new";
}

/** A tool's price by its name, from the public catalogue: "$0.0008–$0.001 a call", "Free"; null when unknown. */
export function priceOfTool(catalogue: readonly Pick<PublicTool, "name" | "fromPrice" | "price" | "pricingMode" | "routable">[], name: string): string | null {
  const tool = catalogue.find((t) => t.name === name);
  return tool ? priceRangeText([tool]) : null;
}
