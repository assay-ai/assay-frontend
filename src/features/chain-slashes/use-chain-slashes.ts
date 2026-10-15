"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { HexString } from "@/libs/chains/evm/stake-slashes/address";
import type { StakeDeployment } from "@/libs/chains/evm/stake-slashes/deployments";
import { createStakeChainReader, loadChainSlashes } from "@/libs/chains/evm/stake-slashes/load";

import { lookupAssayCases } from "./assay-match";

/**
 * The page's two reads. The first goes to the chain and IS the list; the
 * second goes to Assay and only decorates it — if it fails, the list stands.
 *
 * `matchAgainstAssay` is true only when `provider` is the signed-in provider's
 * own stake wallet. The lookup answers for the signed-in provider's cases, so
 * asking it about an address someone pasted would mark that address's every
 * pending penalty "Not known to Assay" — true of this provider, and meaningless
 * about the address. Off, the lookup does not run and every row is unchecked.
 */
export function useChainSlashes(
  deployment: StakeDeployment,
  provider: HexString | null,
  matchAgainstAssay: boolean,
) {
  const reader = React.useMemo(() => createStakeChainReader(deployment), [deployment]);

  const chain = useQuery({
    queryKey: ["chain-slashes", deployment.chainId, deployment.stakeContract, provider?.toLowerCase()],
    queryFn: () => loadChainSlashes(reader, deployment, provider as HexString),
    enabled: provider !== null,
    retry: 0,
    refetchOnWindowFocus: false,
    // The nav badge, Home and the Penalties page share this read; a full log
    // scan once a minute is plenty (Refresh forces one).
    staleTime: 60_000,
  });

  const requestIds = React.useMemo(
    () => (chain.data?.rows ?? []).map((row) => row.requestId),
    [chain.data],
  );

  const assay = useQuery({
    queryKey: ["chain-slashes", "assay-match", provider?.toLowerCase(), requestIds],
    queryFn: () => lookupAssayCases(requestIds),
    enabled: matchAgainstAssay && requestIds.length > 0,
    retry: 0,
    staleTime: 60_000,
  });

  return { chain, assay };
}

/** Unix seconds, re-read every 30s so countdowns and "can be executed" move on their own. */
export function useNowSeconds(): number {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
