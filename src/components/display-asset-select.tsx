"use client";

import { useQuery } from "@tanstack/react-query";

import { useChains } from "@/hooks/useChains";
import type { Chain } from "@/interfaces/chain";
import {
  heldAssets,
  pickDisplayAsset,
  providerEarningAssets,
  storeDisplayAsset,
  storedDisplayAsset,
} from "@/services";
import { assetName, chainDisplayName } from "@/services/chains.service";

/** `USDG on Robinhood Chain testnet`. */
export function displayAssetLabel(asset: string, chains: readonly Chain[]): string {
  return `${assetName(chains, asset)} on ${chainDisplayName(chains, asset.split("/")[0])}`;
}

type Scope = "buyer" | "provider";

/**
 * The asset the selector shows as picked, for a page that scopes its own rows
 * by it. `current` is `undefined` for a one-asset account; `isPending` is true
 * until that is known.
 */
export function useDisplayAsset(scope: Scope) {
  const query = useQuery({
    queryKey: ["display-assets", scope],
    queryFn: () => (scope === "buyer" ? heldAssets() : providerEarningAssets()),
    staleTime: 60_000,
  });
  const assets = query.data ?? [];
  return {
    assets,
    current: pickDisplayAsset(assets, storedDisplayAsset()),
    isPending: query.isPending,
  };
}

/**
 * Which asset this page's period figures are in — shown only to an account
 * with more than one, because the summary APIs answer in one asset at a time.
 * `scope` says whose assets: what a buyer holds, or what a provider earned in.
 * Picking reloads the page: every figure on it was fetched for the old asset.
 */
export function DisplayAssetSelect({ scope = "buyer" }: { scope?: Scope }) {
  const { chains } = useChains();
  const { assets, current } = useDisplayAsset(scope);
  if (!current) return null;

  return (
    <label className="flex w-full flex-wrap items-center gap-2 text-body-13 text-02">
      {scope === "buyer" ? "You hold more than one asset." : "You were paid in more than one asset."}{" "}
      Figures for a period are shown in
      <select
        aria-label="Asset"
        className="max-w-full rounded-md border border-02 bg-01 px-2 py-1 font-mono text-mono-12 text-01"
        value={current}
        onChange={(event) => {
          storeDisplayAsset(event.target.value);
          window.location.reload();
        }}
      >
        {assets.map((asset) => (
          <option key={asset} value={asset}>
            {displayAssetLabel(asset, chains)}
          </option>
        ))}
      </select>
    </label>
  );
}
