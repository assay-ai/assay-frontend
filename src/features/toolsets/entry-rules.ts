import type { ToolsetEntry, ToolsetEntryInput } from "@/services/toolsets.service";

import { priceText } from "./access-result";
import { PROVIDER_MODE_LABELS } from "./labels";

/**
 * A tool set entry's provider rule (design spec §7.10, "My tool sets"): the
 * per-row chip "Providers: Any (Assay picks) ▾" and the body `PUT …/entries`
 * takes. Pure.
 */

export function defaultEntry(toolId: string): ToolsetEntryInput {
  return { toolId, providerMode: "BEST", providerIds: [], minTier: null, maxPrice: null, minQuality: null, onEmpty: "FAIL" };
}

/** The entry as `PUT /toolsets/:id/entries` takes it (the price without its decimals). */
export function entryInput(entry: ToolsetEntry | ToolsetEntryInput): ToolsetEntryInput {
  return {
    toolId: entry.toolId,
    providerMode: entry.providerMode,
    providerIds: entry.providerMode === "BEST" ? [] : [...entry.providerIds],
    minTier: entry.minTier,
    maxPrice: entry.maxPrice ? { amount: entry.maxPrice.amount, asset: entry.maxPrice.asset } : null,
    minQuality: entry.minQuality,
    onEmpty: entry.onEmpty,
    // T3: sent only when set, so an older Draft keeps the server's default (the current major).
    ...(entry.toolVersionRange ? { toolVersionRange: entry.toolVersionRange } : {}),
    ...(entry.requireOutputFields ? { requireOutputFields: [...entry.requireOutputFields] } : {}),
  };
}

/** Whether the row has any rule beyond "Assay picks". */
export function hasRule(entry: Pick<ToolsetEntryInput, "providerMode" | "minTier" | "maxPrice">): boolean {
  return entry.providerMode !== "BEST" || entry.minTier !== null || entry.maxPrice !== null;
}

/** An entry as the editor holds it: the price may carry its decimals (read) or not (being written). */
export type EntryLike = Pick<ToolsetEntryInput, "providerMode" | "providerIds" | "minTier" | "onEmpty"> & {
  maxPrice: { amount: string; asset: string; decimals?: number } | null;
};

/**
 * The chip: "Providers: Any (Assay picks)", "Providers: Only these (2) ·
 * verified · max $0.01".
 */
export function entryChipLabel(entry: EntryLike, decimals = 6): string {
  const mode = PROVIDER_MODE_LABELS[entry.providerMode];
  const count = entry.providerMode === "BEST" ? "" : ` (${entry.providerIds.length})`;
  const extras: string[] = [];
  if (entry.minTier === "ESTABLISHED") extras.push("verified");
  if (entry.minTier === "TRUSTED") extras.push("trusted");
  const max = entry.maxPrice
    ? priceText({ amount: entry.maxPrice.amount, asset: entry.maxPrice.asset, decimals: entry.maxPrice.decimals ?? decimals })
    : null;
  if (max) extras.push(`max ${max}`);
  return `Providers: ${mode}${count}${extras.length > 0 ? ` · ${extras.join(" · ")}` : ""}`;
}

/** Why a row cannot be saved as it stands, or null. ONLY and EXCLUDE need at least one provider. */
export function entryProblem(entry: Pick<ToolsetEntryInput, "providerMode" | "providerIds">): string | null {
  if (entry.providerMode !== "BEST" && entry.providerIds.length === 0) {
    return entry.providerMode === "ONLY" ? "Pick at least one provider to use." : "Pick at least one provider to leave out.";
  }
  return null;
}

/**
 * How many of a tool's providers the entry's provider list leaves (tier and
 * price are checked by the server on each call, so they are not guessed here).
 */
export function providersLeft(entry: Pick<ToolsetEntryInput, "providerMode" | "providerIds">, serving: readonly string[]): number {
  if (entry.providerMode === "ONLY") return serving.filter((id) => entry.providerIds.includes(id)).length;
  if (entry.providerMode === "EXCLUDE") return serving.filter((id) => !entry.providerIds.includes(id)).length;
  return serving.length;
}

/** A slug from a name, as the backend generates one: `Research kit` → `research-kit`. */
export function slugFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : `${slug || "set"}-1`;
}
