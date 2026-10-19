import type { CatalogueToolVersionFields, ToolVersionList } from "@/interfaces/contracts";
import { api } from "./api";
import type { ToolTier } from "./tools.service";

/**
 * The platform catalogue — everything, for everybody.
 *
 * ## What it replaces
 *
 * Explore used to be folded from `GET /tool-calls`, the caller's own payment
 * history. That made the shop window a function of the receipt drawer: a fresh
 * organization saw **zero** providers on a deployment holding 42, and two
 * people signed in to different accounts saw two different markets. `explore.
 * service.ts` said so in its own header, and this is the endpoint it was
 * waiting for.
 *
 * ## Absent is not zero
 *
 * Three fields are nullable and each null means *we do not know*, never *none*:
 *
 * - `quality` — null until a call to the provider has been checked in the last
 *   30 days (open and closed check windows, D5). Drawing that as 100% would
 *   put the least-proven provider at the top.
 * - `stake` — **a list per chain, and EMPTY when the stake source cannot say**
 *   (an RPC outage, an unproved stake authority, a provider staked in a mode
 *   this deployment does not read). `$0.00` would read as "nothing at risk",
 *   which is a much stronger and quite different claim. Since the per-chain balance rule it is
 *   a list rather than one figure, and the emptiness — not a null — is what
 *   carries "we do not know".
 * - `price` — null when nothing is routable right now; `unroutableReason` says
 *   why, in the router's own words.
 *
 * The screens must render all three as absent rather than substituting a
 * number. `formatMoney(null)` and the `quality == null` branches already do;
 * `stake` is keyed on `length === 0`, because an array is always truthy and a
 * `stake ? … : "—"` test can therefore never reach its own fallback.
 */

export interface CatalogueMoney {
  amount: string;
  asset: string;
  decimals: number;
}

/**
 * One chain's bonded stake.
 *
 * `chainId` rides on the entry rather than being re-parsed out of `asset`,
 * even though a CAIP-19 asset already names its chain: the screen groups and
 * labels by chain, and a derivation on the rendering path is one a wrong asset
 * would silently corrupt.
 */
export interface CatalogueChainStake {
  chainId: string;
  amount: string;
  asset: string;
  decimals: number;
}

/**
 * Quality as the platform measures it, not as a provider claims it.
 *
 * `measuredCalls` is not decoration: 100% of four calls and 95% of sixteen
 * thousand are not the same claim, and a screen that shows only the rate cannot
 * tell them apart.
 */
export interface CatalogueQuality {
  /** Passed ÷ measured, 0..1. */
  rate: number;
  measuredCalls: number;
  failedCalls: number;
}

export interface CatalogueProvider {
  providerId: string;
  legalName: string;
  verified: boolean;
  verifiedAt: string | null;
  tier: string;
  toolIds: string[];
  activeBindings: number;
  /** Cheapest ACTIVE binding this provider serves. */
  fromPrice: CatalogueMoney | null;
  /**
   * Bonded stake, **per chain — a list, never a sum**.
   *
   * A call settles on one chain and is backed only by that chain's collateral,
   * so a total would advertise protection no single call has: $90 on Solana
   * plus $40 on `eip155:4663` renders as $130 and clears a floor neither chain
   * clears. The two are different CAIP-19 assets, so they cannot be compared
   * to pick the lower either.
   *
   * **Empty means not known — never zero.** A chain read as zero appears here
   * as a zero-amount entry; a chain nobody could read does not appear at all.
   */
  stake: CatalogueChainStake[];
  quality: CatalogueQuality | null;
  /** CAIP-2 chains a call to this provider can settle on now (the router's answer); [] when it takes no call; null when unknown. */
  chains?: string[] | null;
  /** Per caller: one of your agents' chains is in `chains`. null when unknown. */
  servesYou?: boolean | null;
  /** Per caller: WITHDRAWING when servesYou is false because every agent has a standing withdrawal. */
  notServedReason?: "WITHDRAWING" | null;
}

export interface CatalogueProviderTool {
  toolId: string;
  name: string;
  pricingMode: string;
  price: CatalogueMoney;
  /** The failure rate this listing promises, 0..1 — what its penalties are measured against. */
  promisedFailureRate?: number;
  /** Free calls one agent gets per UTC day on this listing; null for a PAID one. */
  freeCallsPerAgentPerDay: number | null;
  /** CAIP-2 chains a call to this listing can settle on now; [] when it takes no call; null when unknown. */
  chains?: string[] | null;
  /** Per caller: one of your agents' chains is in `chains`. null when unknown. */
  servesYou?: boolean | null;
  /** Per caller: WITHDRAWING when servesYou is false because every agent has a standing withdrawal. */
  notServedReason?: "WITHDRAWING" | null;
}

export interface CatalogueProviderDetail extends CatalogueProvider {
  tools: CatalogueProviderTool[];
}

/**
 * What a call costs on one chain, and whose listing sets that price — the
 * router's quote for a buyer paying there. A buyer pays on one chain, so a
 * tool on two chains has two prices, not one.
 */
export interface CatalogueChainPrice {
  /** CAIP-2. */
  chainId: string;
  price: CatalogueMoney;
  /** The one provider at that price, from the router's own priced set; null when several share it. */
  providerId: string | null;
  /** Eligible listings on that chain the price was taken over: name the provider only when 1. */
  listings: number;
}

export interface CatalogueTool extends CatalogueToolVersionFields {
  id: string;
  name: string;
  description: string;
  tier: ToolTier;
  providerCount: number;
  /** The market floor — cheapest ACTIVE binding across every provider. */
  fromPrice: CatalogueMoney | null;
  /**
   * What a call would actually be held for.
   *
   * Not the same number as `fromPrice`, and the gap is the design: the router
   * quotes the **dearest** eligible binding so the hold covers whichever
   * provider failover lands on. Showing only the floor would under-quote every
   * call the moment a second provider joined at a higher price.
   */
  price: CatalogueMoney | null;
  pricingMode: string | null;
  /**
   * Free first, then paid: the free calls a day one agent gets before a call
   * is charged — set for FREE and FREEMIUM tools, `null` for a PAID one. A
   * FREEMIUM tool reads "N free per day, then up to {price}".
   */
  freeCallsPerDay: number | null;
  routable: boolean;
  /**
   * Bindings the router could serve this tool from right now — the set `price`
   * is the dearest of. Not `providerCount`: a listed provider the router cannot
   * use (stake on another asset, a ceiling hit) counts there and not here.
   */
  routableBindings: number;
  /**
   * How many of `routableBindings` can be charged (PAID or FREEMIUM). "up to
   * $X" is about these only: a FREE binding beside one paid binding does not
   * make the paid price a range.
   */
  paidBindings: number;
  unroutableReason: string | null;
  /**
   * CAIP-2, the chains any ACTIVE binding for this tool settles on.
   *
   * **Optional because nothing serves it yet.** The backend publishes
   * `assay/settlementChains` on the MCP `tools/list` annotations; the buyer
   * catalogue DTO has no such field, so every row arrives without one today
   * and every row renders exactly as it always has. The seam is one field on
   * the backend's `CatalogueToolDto`.
   *
   * Do not default it to `[]` anywhere between here and the screen. `[]` and
   * `undefined` mean the same thing to `settlementReach`, but an `[]` written
   * by this layer would be this file claiming knowledge it does not have.
   */
  settlementChains?: string[];
  /** The price per chain, with the provider setting it; a chain that cannot be quoted now is left out. */
  prices?: CatalogueChainPrice[];
}

export function listCatalogueProviders(): Promise<{ providers: CatalogueProvider[] }> {
  return api.get<{ providers: CatalogueProvider[] }>("/catalogue/providers");
}

export function listCatalogueTools(): Promise<{ tools: CatalogueTool[] }> {
  return api.get<{ tools: CatalogueTool[] }>("/catalogue/tools");
}

export function getCatalogueProvider(providerId: string): Promise<CatalogueProviderDetail> {
  return api.get<CatalogueProviderDetail>(`/catalogue/providers/${providerId}`);
}

/** T3: a tool's published contract versions, newest first, with schemas, optional fields, examples and changelog. */
export function getCatalogueToolVersions(toolId: string): Promise<ToolVersionList> {
  return api.get<ToolVersionList>(`/catalogue/tools/${encodeURIComponent(toolId)}/versions`);
}
