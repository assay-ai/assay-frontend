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

export interface PublicQuality {
  /** Passed ÷ measured, 0..1. */
  rate: number;
  measuredCalls: number;
  failedCalls: number;
}

export interface PublicTool {
  id: string;
  name: string;
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
  /** Free calls one agent gets per UTC day; null for a PAID listing. */
  freeCallsPerAgentPerDay: number | null;
}

export interface PublicProviderDetail extends PublicProvider {
  tools: PublicProviderTool[];
}

export type NotChargedBucket = "FAILED_VERIFICATION" | "PROVIDER_OR_PLATFORM_ERROR";

export interface PublicNotChargedCall {
  toolId: string;
  toolName: string;
  providerName: string;
  price: Money;
  reason: string;
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
