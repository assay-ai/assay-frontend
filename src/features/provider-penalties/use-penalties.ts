"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { AssayCaseIndex } from "@/features/chain-slashes/assay-match";
import { useChainSlashes, useNowSeconds } from "@/features/chain-slashes/use-chain-slashes";
import { stakeChains } from "@/features/provider-stake/chain-stake";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { demoEnabled } from "@/libs/demo/demo-api";
import {
  DEMO_PENALTY_AMOUNTS,
  DEMO_PENALTY_ANCHOR_SECONDS,
  DEMO_PENALTY_PROPOSALS,
  DEMO_PENALTY_REQUESTS,
} from "@/libs/demo/demo-penalties";
import { normaliseEvmAddress, type HexString } from "@/libs/chains/evm/stake-slashes/address";
import { ROBINHOOD_TESTNET_STAKE } from "@/libs/chains/evm/stake-slashes/deployments";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import { slashStatusOf } from "@/libs/chains/evm/stake-slashes/status";
import { getSlashProposalCaseDetail } from "@/services/provider-slash-cases.service";
import { addressOfAccount } from "@/utils/chain";

import { penaltyRowOf, sortPenalties, type PenaltyRow } from "./model";
import { providerQueries } from "@/features/provider-home/queries";
import { splitOfParams } from "@/features/provider-slash-case/distribution";
import { useChainTerms } from "@/hooks/useChainTerms";

export const PENALTY_DEPLOYMENT = ROBINHOOD_TESTNET_STAKE;

/** The query key of one Assay case, shared with every surface that reads it. */
export const caseKey = (proposalId: string) => ["provider", "slash-proposal-case", proposalId] as const;

/**
 * The last rows read for a stake wallet, kept in this browser so a slow chain
 * read shows the last-known penalties ("updating") instead of a spinner. A
 * convenience only: the chain read replaces them as soon as it lands, and an
 * unreadable store just means no head start.
 */
const LAST_KNOWN_KEY = (address: string) =>
  `assay.provider.penalties.v2:${PENALTY_DEPLOYMENT.chainId}:${PENALTY_DEPLOYMENT.stakeContract.toLowerCase()}:${address.toLowerCase()}`;
/** The first version keyed by wallet only, so it could show rows of a contract that no longer exists. */
const LEGACY_KEY = (address: string) => `assay.provider.penalties.v1:${address.toLowerCase()}`;

export function readLastKnown(address: string, nowSeconds: number): PenaltyRow[] | null {
  try {
    const raw = window.localStorage.getItem(LAST_KNOWN_KEY(address));
    if (!raw) return null;
    const rows = JSON.parse(raw) as PenaltyRow[];
    if (!Array.isArray(rows)) return null;
    // A stored "can dispute" goes stale with the clock; recompute it.
    return rows.map((row) => ({
      ...row,
      canDispute: row.chainKey === "pending" && nowSeconds * 1000 < Date.parse(row.executableAt),
    }));
  } catch {
    return null;
  }
}

export function writeLastKnown(address: string, rows: readonly PenaltyRow[]): void {
  try {
    window.localStorage.removeItem(LEGACY_KEY(address));
    window.localStorage.setItem(LAST_KNOWN_KEY(address), JSON.stringify(rows));
  } catch {
    // Private window or blocked storage: nothing to keep.
  }
}

/** DEMO ONLY: the three records, dated from the demo's fixed anchor (`nowSeconds` is that anchor). */
function demoChain(nowSeconds: number): { rows: ChainSlashRow[]; index: AssayCaseIndex } {
  const atomic = (major: string) => BigInt(Math.round(Number(major) * 1_000_000));
  const base = {
    beneficiary: "0x0000000000000000000000000000000000000000" as const,
    cancelReason: null,
    upheld: false,
    upheldAt: null,
    upheldTx: null,
    disputeTx: null,
    proposeTx: null,
    closeTx: null,
    stateSource: "record" as const,
  };
  const h = 3600;
  const rows: ChainSlashRow[] = [
    {
      ...base,
      requestId: DEMO_PENALTY_REQUESTS[0],
      status: slashStatusOf(1),
      penalty: atomic(DEMO_PENALTY_AMOUNTS[0]),
      reserved: atomic(DEMO_PENALTY_AMOUNTS[0]),
      applied: null,
      proposedAt: nowSeconds - 20 * h,
      executableAt: nowSeconds + 52 * h,
      disputedAt: null,
      disputeExpiresAt: null,
    },
    {
      ...base,
      requestId: DEMO_PENALTY_REQUESTS[1],
      status: slashStatusOf(4),
      penalty: atomic(DEMO_PENALTY_AMOUNTS[1]),
      reserved: atomic(DEMO_PENALTY_AMOUNTS[1]),
      applied: null,
      proposedAt: nowSeconds - 95 * h,
      executableAt: nowSeconds + 48 * h,
      disputedAt: nowSeconds - 72 * h,
      disputeExpiresAt: nowSeconds - 72 * h + 30 * 86_400,
    },
    {
      ...base,
      requestId: DEMO_PENALTY_REQUESTS[2],
      status: slashStatusOf(2),
      penalty: atomic(DEMO_PENALTY_AMOUNTS[2]),
      reserved: atomic(DEMO_PENALTY_AMOUNTS[2]),
      applied: atomic(DEMO_PENALTY_AMOUNTS[2]),
      proposedAt: nowSeconds - 250 * h,
      executableAt: nowSeconds - 178 * h,
      disputedAt: null,
      disputeExpiresAt: null,
    },
  ];
  const known = new Map(DEMO_PENALTY_REQUESTS.map((id, i) => [id.toLowerCase(), { proposalId: DEMO_PENALTY_PROPOSALS[i] }]));
  return { rows, index: { status: "checked", known } };
}

/**
 * Every penalty on the provider's own stake wallet, read from the chain and
 * matched to Assay's cases. Shared by the Penalties page, the nav badge and
 * Home (same query keys, so one read serves all).
 */
export function usePenalties(options: { withCases?: "open" | "all" | "none" } = {}) {
  const { withCases = "open" } = options;
  const nowSeconds = useNowSeconds();
  const demo = demoEnabled();

  const stake = useQuery(providerQueries.stake());
  const authority =
    stakeChains(stake.data).find((entry) => entry.chainId === PENALTY_DEPLOYMENT.chainId)?.stakeAuthority ?? null;
  const ownAddress: HexString | null = authority ? normaliseEvmAddress(addressOfAccount(authority)) : null;

  const { chain, assay } = useChainSlashes(PENALTY_DEPLOYMENT, demo ? null : ownAddress, !demo);
  // The demo's rows count from one fixed anchor, the same one the demo cases use,
  // so a deadline never moves between screens or renders.
  const demoData = React.useMemo(() => (demo ? demoChain(DEMO_PENALTY_ANCHOR_SECONDS) : null), [demo]);

  const asset = demo
    ? { decimals: 6, symbol: "USDG", fromChain: true }
    : (chain.data?.asset ?? { decimals: PENALTY_DEPLOYMENT.fallbackAssetDecimals, symbol: PENALTY_DEPLOYMENT.fallbackAssetSymbol, fromChain: false });
  const index = demo ? demoData!.index : (assay.data ?? null);
  const chainRows = demo ? demoData!.rows : chain.data?.rows;

  const { decimals, symbol } = asset;
  const { params: chainParams } = useChainTerms(PENALTY_DEPLOYMENT.chainId);
  const chainSplit = React.useMemo(() => splitOfParams(chainParams), [chainParams]);
  const liveRows: PenaltyRow[] = React.useMemo(
    () =>
      sortPenalties(
        (chainRows ?? []).map((row) => penaltyRowOf(row, { decimals, symbol }, index, nowSeconds, chainSplit)),
      ),
    [chainRows, decimals, symbol, index, nowSeconds, chainSplit],
  );

  // Last-known rows while the chain read is still in flight (read after mount,
  // so the server render and the first client render agree).
  const [lastKnown, setLastKnown] = React.useState<PenaltyRow[] | null>(null);
  React.useEffect(() => {
    setLastKnown(!demo && ownAddress ? readLastKnown(ownAddress, Math.floor(Date.now() / 1000)) : null);
  }, [demo, ownAddress]);
  React.useEffect(() => {
    // The chain read is authoritative: it overwrites the cache, an empty read included.
    // Rows are matched to Assay's cases only when that lookup was checked, so a
    // non-empty list waits for it; an empty one has nothing to match.
    if (!demo && ownAddress && chain.data && (index?.status === "checked" || liveRows.length === 0)) {
      writeLastKnown(ownAddress, liveRows);
    }
  }, [demo, ownAddress, chain.data, index, liveRows]);
  const updating = !demo && !chainRows && chain.isLoading && lastKnown !== null;
  const rows = updating ? lastKnown! : liveRows;

  const wanted = rows.filter((row) => row.proposalId && (withCases === "all" || (withCases === "open" && row.tab !== "closed")));
  const cases = useQueries({
    queries: wanted.map((row) => ({
      queryKey: caseKey(row.proposalId!),
      queryFn: () => getSlashProposalCaseDetail(row.proposalId!),
      retry: 0,
      staleTime: 60_000,
    })),
  });
  const caseById = new Map<string, SlashProposalCaseDetail>();
  wanted.forEach((row, i) => {
    const data = cases[i]?.data;
    if (data) caseById.set(row.proposalId!, data);
  });

  return {
    rows,
    caseFor: (row: PenaltyRow) => (row.proposalId ? (caseById.get(row.proposalId) ?? null) : null),
    ownAddress: demo ? ("0x9F2c8A1e5D7b30C4f6A8e2B915D3c7E04A6b1F82" as HexString) : ownAddress,
    demo,
    nowSeconds,
    asset,
    isLoading: stake.isLoading || (!demo && ownAddress !== null && chain.isLoading && !updating),
    /** Showing the last-known rows while the chain read runs. */
    updating,
    isFetching: chain.isFetching,
    isError: !demo && chain.isError,
    error: chain.error,
    noStakeWallet: !demo && stake.isSuccess && ownAddress === null,
    lookupUnavailable: !demo && assay.data?.status === "unavailable",
    refetch: () => (demo ? Promise.resolve() : chain.refetch()),
  };
}
