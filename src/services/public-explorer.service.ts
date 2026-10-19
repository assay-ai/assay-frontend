import type { CatalogueToolVersionFields, ToolVersionList } from "@/interfaces/contracts";
import type { Money } from "@/interfaces";

import { api } from "./api";

/**
 * The public Explorer: the signed-out catalogue and the "not charged" proof
 * feed. Unauthenticated reads (`GET /public/catalogue/*`, `GET /public/not-charged`)
 * that carry aggregated platform data only — no buyer, organization or call ids.
 *
 * Provider-written text (names, descriptions) arrives here verbatim and must be
 * rendered as plain text: React escapes it; never pass it to
 * `dangerouslySetInnerHTML`.
 *
 * A 429 carries `Retry-After`; the screens show it as a plain "try again" error.
 */

export type PricingMode = "FREE" | "FREEMIUM" | "PAID";

export interface PublicChainStake extends Money {
  /** CAIP-2. */
  chainId: string;
}

/** The price per chain, with the provider whose listing sets it (`prices[]`). */
export interface PublicChainPrice {
  /** CAIP-2. */
  chainId: string;
  price: Money;
  /** The one provider at that price; null when several share it. */
  providerId: string | null;
  /** Eligible listings on that chain: name the provider only when 1. */
  listings: number;
}

/** Measured over the last 30 days, open and closed check windows (D5). */
export interface PublicQuality {
  /** Passed ÷ measured, 0..1. */
  rate: number;
  measuredCalls: number;
  failedCalls: number;
}

export interface PublicTool extends CatalogueToolVersionFields {
  id: string;
  name: string;
  /**
   * The tool's topic (`tools.category`), for `/catalogue?category=`. Not sent by
   * `GET /public/catalogue/tools` yet; without it the page cannot filter by topic.
   */
  category?: string | null;
  description: string;
  tier: string;
  providerCount: number;
  /** Cheapest listed price. */
  fromPrice: Money | null;
  /** The most a call is held for (and charged). null when nothing is routable. */
  price: Money | null;
  pricingMode: string | null;
  routable: boolean;
  /** CAIP-2 chains a call would settle on; null when nothing is routable. */
  settlementChains: string[] | null;
  /** The price per chain, with the provider setting it; empty when nothing is routable. */
  prices?: PublicChainPrice[];
  /**
   * Routable listings that can be charged (PAID or FREEMIUM). "from" is printed
   * only over more than one.
   */
  paidBindings: number;
  /**
   * The backend's free calls per agent per day for a FREEMIUM tool (its total
   * over every free-capable listing, capped). Null for a PAID one.
   */
  freeCallsPerDay: number | null;
  /** STANDARD: backed by several providers. PROVIDER: one maker's own API (`{handle}__{tool}`). */
  kind?: "STANDARD" | "PROVIDER" | string;
  /** The maker's public name, on a PROVIDER tool. */
  handle?: string | null;
  /** A provider tool no operator approved. The catalogue lists reviewed tools only, so normally false. */
  notReviewed?: boolean;
}

export interface PublicProvider {
  providerId: string;
  name: string;
  verified: boolean;
  tier: string;
  toolIds: string[];
  fromPrice: Money | null;
  /** Per chain, never a sum. Empty means not known — never zero. */
  stake: PublicChainStake[];
  /** null until measured. */
  quality: PublicQuality | null;
}

export interface PublicProviderTool {
  toolId: string;
  name: string;
  pricingMode: string;
  price: Money;
  /** The failure rate this listing promises, 0..1. */
  promisedFailureRate?: number;
  /** Free calls one agent gets per UTC day; null for a PAID listing. */
  freeCallsPerAgentPerDay: number | null;
}

export interface PublicProviderDetail extends PublicProvider {
  tools: PublicProviderTool[];
}

export type NotChargedBucket = "FAILED_VERIFICATION" | "PROVIDER_OR_PLATFORM_ERROR";

/**
 * Why a paid call ended without a charge (`GET /public/not-charged`).
 * `NOT_COLLECTED`: the provider forfeited the payment; the buyer was not
 * charged and does not owe it. It rides
 * in the PROVIDER_OR_PLATFORM_ERROR bucket. Owed (buyer debt) calls never
 * appear in the feed.
 */
export type NotChargedReason =
  | "FAILED_CHECK"
  | "OUT_OF_SCOPE"
  | "PROVIDER_ERROR"
  | "REQUEST_REJECTED"
  | "NO_USABLE_RESULT"
  | "EXPIRED"
  | "NOT_COLLECTED";

export interface PublicNotChargedCall {
  toolId: string;
  toolName: string;
  providerName: string;
  price: Money;
  /** A `NotChargedReason` key; a key this build does not know is shown by its `reasonText`. */
  reason: NotChargedReason | (string & {});
  /** The server's one plain sentence, fixed per reason. */
  reasonText: string;
  bucket: NotChargedBucket;
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
}

export interface PublicNotCharged {
  windowDays: number;
  since: string;
  until: string;
  minBuyers: number;
  withheldForPrivacy: boolean;
  totals: {
    callsChecked: number;
    callsNotCharged: number;
    callsFailedCheck: number;
    /** One entry per asset — a list, never a sum. */
    amountNotCharged: Money[];
    /**
     * The not-charged calls that did not fail the check, by reason, largest
     * first (never `FAILED_CHECK`). A reason is listed only when every part of
     * its figure comes from at least `minBuyers` buyers.
     */
    notChargedByReason: { reason: NotChargedReason | (string & {}); calls: number }[];
    /** The rest of those calls: reasons too rare to list on their own. */
    callsNotChargedOther: number;
  };
  recent: PublicNotChargedCall[];
}

export function listPublicTools(): Promise<{ tools: PublicTool[] }> {
  return api.get<{ tools: PublicTool[] }>("/public/catalogue/tools");
}

export function listPublicProviders(): Promise<{ providers: PublicProvider[] }> {
  return api.get<{ providers: PublicProvider[] }>("/public/catalogue/providers");
}

export function getPublicProvider(providerId: string): Promise<PublicProviderDetail> {
  return api.get<PublicProviderDetail>(`/public/catalogue/providers/${encodeURIComponent(providerId)}`);
}

export function getPublicNotCharged(): Promise<PublicNotCharged> {
  return api.get<PublicNotCharged>("/public/not-charged");
}

/** T3: a catalogue tool's published contract versions and changelog — no sign-in. */
export function getPublicToolVersions(toolId: string): Promise<ToolVersionList> {
  return api.get<ToolVersionList>(`/public/catalogue/tools/${encodeURIComponent(toolId)}/versions`);
}
