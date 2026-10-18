import { callPrice } from "@/features/provider-home/format";
import type { BindingStatus, Money, PricingMode } from "@/interfaces";

/**
 * The provider console's words for what it lists, in one place, so Home, the
 * Listings page and a listing's Overview say the same thing the same way.
 *
 *  - a **listing** is your endpoint serving a tool from the catalogue (the
 *    routes still say "bindings"; the screens never do);
 *  - **your API** is a new tool only you serve, published under your name
 *    (its listing shows up among the listings too, marked "Your API");
 *  - a **tool request** asks Assay to add a catalogue tool.
 */
export const LISTING_KINDS_SENTENCE =
  "A listing is your API serving a tool from the catalogue: others may serve the same tool, so buyers get a backup. " +
  "Your API is a new tool, published under your public name, that only you serve. Want a catalogue tool that does not exist yet? Request it.";

/**
 * What kind of listing a row is, for its second line (never its address):
 * a provider tool is named `handle__tool`, so its listing serves your API.
 */
export function listingKind(toolName: string | null): string | null {
  if (!toolName) return null;
  return /^[a-z][a-z0-9-]{2,23}__/.test(toolName) ? "Your API · only you serve it" : "Catalogue tool";
}

/** One price format everywhere: "Free", "$0.10 a call", "Free calls, then $0.10 a call". */
export function priceLine(binding: { pricingMode: PricingMode; price: Money | null }): string {
  if (binding.pricingMode === "FREE") return "Free";
  const price = `${callPrice(binding.price)} a call`;
  return binding.pricingMode === "FREEMIUM" ? `Free calls, then ${price}` : price;
}

const ORDER: Record<BindingStatus, number> = { ACTIVE: 0, PAUSED: 1, SUSPENDED: 1, DRAFT: 2 };

/** Live first, then paused, then drafts; otherwise the order the API gave. */
export function liveFirst<T extends { status: BindingStatus }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => ORDER[a.item.status] - ORDER[b.item.status] || a.index - b.index)
    .map(({ item }) => item);
}

/** Home: published listings shown one by one, drafts folded into one "Drafts (n)" row. */
export function foldDrafts<T extends { status: BindingStatus }>(items: readonly T[]): { shown: T[]; drafts: T[] } {
  const sorted = liveFirst(items);
  return {
    shown: sorted.filter((item) => item.status !== "DRAFT"),
    drafts: sorted.filter((item) => item.status === "DRAFT"),
  };
}
