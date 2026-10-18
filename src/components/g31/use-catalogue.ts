"use client";

import type { ToolVersionBrief } from "@/interfaces/contracts";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { ChainPrice } from "@/features/explorer/explorer-text";
import type { Money } from "@/interfaces";
import {
  listCatalogueProviders,
  listCatalogueTools,
  type CatalogueProvider,
  type CatalogueTool,
} from "@/services/catalogue.service";
import { listToolCalls, type ToolCall } from "@/services/tool-calls.service";
import { presentVerdict } from "@/utils/verdict";

import type { ChainStake } from "./format";

/**
 * The catalogue — **the platform's**, not the caller's.
 *
 * ## What changed, and why it mattered
 *
 * This hook used to fold the caller's own `/tool-calls` feed into provider and
 * tool rows, because nothing enumerated the platform: `GET /providers` did not
 * exist as a list, and there was no tools resource on the buyer surface at all.
 * The consequence was a shop window that was a function of the receipt drawer.
 * A fresh organization saw **zero** providers on a deployment holding 42 of
 * them, and two people signed in to different accounts saw two different
 * markets. `GET /catalogue/*` is the endpoint that comment was waiting for.
 *
 * ## Two sources now, and the split is the whole design
 *
 * ```text
 * GET /catalogue/*     WHO exists, WHAT they charge, HOW GOOD they are
 *                      identical for every caller, measured by the platform
 * GET /tool-calls      what YOU spent with them
 *                      your organization's own history, nobody else's
 * ```
 *
 * A row exists because the catalogue says so, never because you called it. Your
 * own traffic only ever *decorates* a row — `yourCalls`, `listed`, `charged` —
 * and its absence is normal rather than a gap. That is why the traffic query's
 * failure does not fail the screen: `calls` falls back to empty, every row
 * still renders, and the columns that were yours read zero.
 *
 * ## Quality is now the platform's measurement
 *
 * The old `quality` was passed-over-measured across **your** calls. The new one
 * is summed from the provider's SLA windows of the last 30 days, open and
 * closed (D5) — the counters the penalties are judged on, window by window. It
 * is the same for every buyer, and `measuredCalls` rides along because 100% of
 * four calls and 95% of sixteen thousand are not the same claim.
 *
 * `null` still means **not measured**, and still must not render as a number.
 */

export interface ProviderRow {
  providerId: string;
  /** The provider's registered name. */
  name: string;
  verified: boolean;
  verifiedAt: string | null;
  tier: string;
  /** Tools they serve with an ACTIVE binding — what you could call today. */
  toolIds: string[];
  activeBindings: number;
  /** Cheapest ACTIVE binding of theirs. */
  fromPrice: Money | null;
  /**
   * Bonded stake, **per chain — a list, never a sum**.
   *
   * **An EMPTY list is "not known", never zero.** It is passed through
   * untouched: nothing here adds two chains together, drops all but the first,
   * or picks a "lowest" across two different assets.
   */
  stake: ChainStake[];
  /** Platform-measured pass rate, 0..1, last 30 days. null until a call was checked. */
  quality: number | null;
  /** The denominator behind `quality`. 0 when `quality` is null. */
  measuredCalls: number;
  /** Measured calls that failed. 0 when `quality` is null. */
  failedCalls: number;
  /** Calls **your** organization made to them. Zero is the normal case now. */
  yourCalls: number;
  /** Chains a call to them can settle on now (the router's answer); [] = takes no call now; null = could not be read. */
  chains?: string[] | null;
  /** Whether a call from one of your agents can settle with them now; null/undefined = unknown. */
  servesYou?: boolean | null;
  /** WITHDRAWING when they don't serve you because every agent of yours is withdrawing. */
  notServedReason?: "WITHDRAWING" | null;
}

export interface ToolRow {
  toolId: string;
  name: string;
  description: string;
  /** UNVERIFIED | VERIFIED | GUARANTEED — how much of each call is checked. */
  tier: string;
  /** FREE | FREEMIUM | PAID, or null when nothing is routable. */
  pricingMode: string | null;
  /** Distinct providers with an ACTIVE binding — the depth of the market. */
  providerCount: number;
  /** The market floor. */
  fromPrice: Money | null;
  /** What a call would be held for — the dearest eligible binding, not the floor. */
  price: Money | null;
  /**
   * Routable bindings that can be charged (PAID or FREEMIUM); above one, the
   * quote reads "up to". Falls back to `routableBindings` for a backend that
   * predates the field, the same fallback MCP `tools/list` uses.
   */
  paidBindings: number | undefined;
  /** Free calls per agent per day before a FREEMIUM tool's quote applies (the backend's total, capped). */
  freeCallsPerDay?: number | null;
  routable: boolean;
  unroutableReason: string | null;
  /**
   * CAIP-2, the chains this tool settles on — or `undefined` when the API said
   * nothing, which is every row today. Passed straight through and **never**
   * defaulted to `[]`: the two are the same to `settlementReach`, and an `[]`
   * written here would be this hook claiming knowledge it does not have.
   */
  settlementChains: string[] | undefined;
  /** The price per chain, with the provider setting it; empty when the API sends none. */
  prices?: ChainPrice[];
  /** Your own traffic on this tool. */
  yourCalls: number;
  /** T3: the version unpinned URLs serve, e.g. "2.0.0"; absent on an older backend. */
  version?: string | null;
  /** T3: every published version, newest first, with status and sunset. */
  versions?: ToolVersionBrief[];
  /** T3: majors still serving until their sunset. */
  deprecatedMajors?: number[];
  replacementName?: string | null;
  replacementVersion?: string | null;
  listed: Money | null;
  charged: Money | null;
}

function addMoney(a: Money | null, b: Money): Money {
  if (!a) return b;
  return { ...a, amount: String(BigInt(a.amount || "0") + BigInt(b.amount || "0")) };
}

/**
 * Whether this call's verdict says anything about money.
 *
 * Kept from the traffic-derived version because the spend columns still need
 * it: a verdict whose presentation has `charged: null` — `UNVERIFIED`,
 * `EMPTY_UNVERIFIED`, and a null verdict on an expired call — is not counted
 * either way.
 */
function saysSomethingAboutMoney(call: ToolCall): boolean {
  return presentVerdict(call.verdict).charged !== null;
}

export function useCatalogue() {
  const providersQuery = useQuery({
    queryKey: ["catalogue", "providers"],
    retry: false,
    staleTime: 60 * 1000,
    queryFn: listCatalogueProviders,
  });

  const toolsQuery = useQuery({
    queryKey: ["catalogue", "tools"],
    retry: false,
    staleTime: 60 * 1000,
    queryFn: listCatalogueTools,
  });

  /**
   * Your own history — decoration, never the row source.
   *
   * 100 is the API's hard ceiling; `limit` above it is a 400 VALIDATION_FAILED,
   * not a silent clamp. A failure here is deliberately swallowed: it costs the
   * "your spend" columns, not the catalogue.
   */
  const callsQuery = useQuery({
    queryKey: ["tool-calls", "catalogue"],
    retry: false,
    queryFn: () => listToolCalls({ limit: 100, from: new Date(Date.now() - 30 * 86_400_000).toISOString() }),
  });
  /**
   * The window the "your calls" counts cover, said next to every count: the
   * last 30 days, or — when the agents made more than one page of calls in that
   * time — only the most recent 100.
   */
  const callsWindow = callsQuery.data?.pageInfo?.hasMore ? "in your last 100 calls" : "in the last 30 days";

  const calls = React.useMemo(() => callsQuery.data?.items ?? [], [callsQuery.data]);

  const providers: ProviderRow[] = React.useMemo(() => {
    const rows = providersQuery.data?.providers ?? [];

    return rows.map((row: CatalogueProvider) => ({
      providerId: row.providerId,
      name: row.legalName,
      verified: row.verified,
      verifiedAt: row.verifiedAt,
      tier: row.tier,
      toolIds: row.toolIds,
      activeBindings: row.activeBindings,
      fromPrice: row.fromPrice,
      stake: row.stake,
      quality: row.quality ? row.quality.rate : null,
      measuredCalls: row.quality ? row.quality.measuredCalls : 0,
      failedCalls: row.quality ? row.quality.failedCalls : 0,
      yourCalls: calls.filter((call) => call.providerId === row.providerId).length,
      chains: row.chains,
      servesYou: row.servesYou,
      notServedReason: row.notServedReason,
    }));
  }, [providersQuery.data, calls]);

  const tools: ToolRow[] = React.useMemo(() => {
    const rows = toolsQuery.data?.tools ?? [];

    return rows.map((row: CatalogueTool) => {
      const own = calls.filter((call) => call.toolId === row.id);
      let listed: Money | null = null;
      let charged: Money | null = null;

      for (const call of own) {
        if (!saysSomethingAboutMoney(call)) continue;
        listed = addMoney(listed, call.price);
        charged = addMoney(charged, call.charged);
      }

      return {
        toolId: row.id,
        name: row.name,
        description: row.description,
        tier: row.tier,
        pricingMode: row.pricingMode,
        providerCount: row.providerCount,
        fromPrice: row.fromPrice,
        price: row.price,
        paidBindings: row.paidBindings ?? row.routableBindings,
        freeCallsPerDay: row.freeCallsPerDay,
        routable: row.routable,
        unroutableReason: row.unroutableReason,
        settlementChains: row.settlementChains,
        prices: row.prices ?? [],
        yourCalls: own.length,
        version: row.version,
        versions: row.versions,
        deprecatedMajors: row.deprecatedMajors,
        replacementName: row.replacementName ?? null,
        replacementVersion: row.replacementVersion ?? null,
        listed,
        charged,
      };
    });
  }, [toolsQuery.data, calls]);

  return {
    /** Pending only while the CATALOGUE is loading — your history is decoration. */
    isPending: providersQuery.isPending || toolsQuery.isPending,
    isError: providersQuery.isError || toolsQuery.isError,
    error: providersQuery.error ?? toolsQuery.error,
    calls,
    callsWindow,
    providers,
    tools,
  };
}
