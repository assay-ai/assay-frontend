import type { Money } from "@/interfaces";
import type { OnEmpty, ProviderMode } from "@/services/toolsets.service";

/**
 * Whether a provider serves THIS buyer now, from the catalogue's own fields:
 * `chains` (the router's answer: chains a call to it can settle on now) and
 * `servesYou` (one of those is a chain one of your agents pays on). Both are
 * computed by the backend; this only words them.
 *
 * Advisory only: the server's routing rules decide every call.
 */
export type ServingKind = "serves" | "other-chain" | "not-taking-calls" | "unknown" | "not-loaded";

export interface ServingStatus {
  kind: ServingKind;
  /** Short chip text; empty for `not-loaded`, which shows no chip. */
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

/**
 * `servesYou` decides first: `null` is the backend's "could not check" (a
 * router or escrow read failed) and reads "Can't check right now", never "Not
 * taking calls"; `undefined` means nothing has loaded yet and shows nothing.
 * Only a known `false` is split by `chains` into "not taking calls" (no chain
 * at all) and "doesn't take payment on your chain".
 */
export function servingStatus(fit: { chains?: readonly string[] | null; servesYou?: boolean | null } | null | undefined): ServingStatus {
  if (fit?.servesYou === undefined) return { kind: "not-loaded", label: "", tone: "neutral" };
  if (fit.servesYou === null) return { kind: "unknown", label: "Can't check right now", tone: "neutral" };
  if (fit.servesYou) return { kind: "serves", label: "Serves you", tone: "success" };
  if (Array.isArray(fit.chains) && fit.chains.length === 0) return { kind: "not-taking-calls", label: "Not taking calls now", tone: "danger" };
  return { kind: "other-chain", label: "Doesn't take payment on your chain", tone: "warning" };
}

/** One provider's listing of one tool, as the provider picker shows it. */
export interface ProviderOffer {
  providerId: string;
  name: string;
  /** NEW | ESTABLISHED | TRUSTED. */
  tier: string;
  /** This provider's own price for the tool; null until its page has loaded. */
  price: Money | null;
  chains?: readonly string[] | null;
  servesYou?: boolean | null;
}

export interface RuleDraft {
  providerMode: ProviderMode;
  providerIds: readonly string[];
  /** The tier the rule saves: ESTABLISHED leaves NEW out; TRUSTED leaves NEW and ESTABLISHED out. */
  minTier: "ESTABLISHED" | "TRUSTED" | null;
  /** Atomic units, or null for no limit. */
  maxPriceAtomic: string | null;
  /** The asset `maxPriceAtomic` is in; a listing priced in another asset is not compared. */
  maxPriceAsset: string | null;
  onEmpty: OnEmpty;
}

const TIER_RANK: Record<string, number> = { NEW: 0, ESTABLISHED: 1, TRUSTED: 2 };

/** The providers a rule keeps, before the router's own gates. */
export function keptByRule(rule: RuleDraft, offers: readonly ProviderOffer[]): ProviderOffer[] {
  return offers.filter((offer) => {
    if (rule.providerMode === "ONLY" && !rule.providerIds.includes(offer.providerId)) return false;
    if (rule.providerMode === "EXCLUDE" && rule.providerIds.includes(offer.providerId)) return false;
    if (rule.minTier && (TIER_RANK[offer.tier] ?? 0) < TIER_RANK[rule.minTier]) return false;
    if (
      rule.maxPriceAtomic !== null &&
      offer.price &&
      offer.price.asset === rule.maxPriceAsset &&
      BigInt(offer.price.amount) > BigInt(rule.maxPriceAtomic)
    )
      return false;
    return true;
  });
}

/**
 * The warning shown before Apply when a rule would leave this buyer nothing
 * that runs, or `null` when something does (or the data cannot say).
 *
 * Only a known "doesn't serve you" counts against a provider: a row whose
 * status has not loaded is given the benefit of the doubt, so the warning is
 * never raised on missing data. With "If no provider fits: Assay picks", the
 * call falls back to any provider, so it warns only when none serves you.
 */
export function nothingRunsWarning(rule: RuleDraft, offers: readonly ProviderOffer[], toolName: string): string | null {
  if (offers.length === 0) return null;
  // Only a known "doesn't serve you" counts against a provider.
  const serves = (offer: ProviderOffer) => ["serves", "unknown", "not-loaded"].includes(servingStatus(offer).kind);
  const kept = keptByRule(rule, offers);
  if (kept.some(serves)) return null;
  if (rule.onEmpty === "FALLBACK_BEST" && offers.some(serves)) return null;
  const refused = `Every ${toolName} call from your agents would be refused (not charged).`;
  if (kept.length === 0) return `No provider is left under this rule. ${refused}`;
  const reasons = kept.map((offer) => `${offer.name} ${servingStatus(offer).kind === "not-taking-calls" ? "isn't taking calls now" : "doesn't take payment on your chain"}`);
  return `Nothing left can run for you: ${reasons.join("; ")}. ${refused}`;
}

/**
 * "Takes payment on Solana devnet" / "…on A and B"; null when the chains are
 * not known. "Takes no calls right now" only when that is known (`servesYou`
 * is a boolean), never for an unchecked provider.
 */
export function chainsText(fit: { chains?: readonly string[] | null; servesYou?: boolean | null }, chainName: (chainId: string) => string): string | null {
  const { chains } = fit;
  if (!Array.isArray(chains)) return null;
  if (chains.length === 0 && typeof fit.servesYou !== "boolean") return null;
  if (chains.length === 0) return "Takes no calls right now";
  const names = chains.map(chainName);
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Takes payment on ${list}`;
}
