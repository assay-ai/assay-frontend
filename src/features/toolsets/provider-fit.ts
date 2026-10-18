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
export type ServingKind = "serves" | "other-chain" | "not-taking-calls" | "unknown";

export interface ServingStatus {
  kind: ServingKind;
  /** Short chip text; empty for `unknown`, which shows no chip. */
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

export function servingStatus(fit: { chains?: readonly string[] | null; servesYou?: boolean | null } | null | undefined): ServingStatus {
  if (fit?.servesYou === true) return { kind: "serves", label: "Serves you", tone: "success" };
  if (Array.isArray(fit?.chains) && fit.chains.length === 0) return { kind: "not-taking-calls", label: "Not taking calls now", tone: "danger" };
  if (fit?.servesYou === false) return { kind: "other-chain", label: "Doesn't take payment on your chain", tone: "warning" };
  return { kind: "unknown", label: "", tone: "neutral" };
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
  /** "Only verified providers": a NEW provider is left out. */
  verifiedOnly: boolean;
  /** Atomic units in the offers' asset scale, or null for no limit. */
  maxPriceAtomic: string | null;
  onEmpty: OnEmpty;
}

/** The providers a rule keeps, before the router's own gates. */
export function keptByRule(rule: RuleDraft, offers: readonly ProviderOffer[]): ProviderOffer[] {
  return offers.filter((offer) => {
    if (rule.providerMode === "ONLY" && !rule.providerIds.includes(offer.providerId)) return false;
    if (rule.providerMode === "EXCLUDE" && rule.providerIds.includes(offer.providerId)) return false;
    if (rule.verifiedOnly && offer.tier === "NEW") return false;
    if (rule.maxPriceAtomic !== null && offer.price && BigInt(offer.price.amount) > BigInt(rule.maxPriceAtomic)) return false;
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
  const serves = (offer: ProviderOffer) => servingStatus(offer).kind === "serves" || servingStatus(offer).kind === "unknown";
  const kept = keptByRule(rule, offers);
  if (kept.some(serves)) return null;
  if (rule.onEmpty === "FALLBACK_BEST" && offers.some(serves)) return null;
  const refused = `Every ${toolName} call from your agents would be refused (not charged).`;
  if (kept.length === 0) return `No provider is left under this rule. ${refused}`;
  const reasons = kept.map((offer) => `${offer.name} ${servingStatus(offer).kind === "not-taking-calls" ? "isn't taking calls now" : "doesn't take payment on your chain"}`);
  return `Nothing left can run for you: ${reasons.join("; ")}. ${refused}`;
}

/** "Takes payment on Solana devnet" / "…on A and B"; null when the chains are not known. */
export function chainsText(chains: readonly string[] | null | undefined, chainName: (chainId: string) => string): string | null {
  if (!Array.isArray(chains)) return null;
  if (chains.length === 0) return "Takes no calls right now";
  const names = chains.map(chainName);
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Takes payment on ${list}`;
}
