"use client";

import { useQuery } from "@tanstack/react-query";

import { useChains } from "@/hooks/useChains";
import type { Chain } from "@/interfaces/chain";
import { heldAssets, pickDisplayAsset, storeDisplayAsset, storedDisplayAsset } from "@/services";
import { assetName, chainDisplayName } from "@/services/chains.service";

/** `USDG on Robinhood Chain testnet`. */
export function displayAssetLabel(asset: string, chains: readonly Chain[]): string {
  return `${assetName(chains, asset)} on ${chainDisplayName(chains, asset.split("/")[0])}`;
}

/**
 * Which asset this page's period figures are in — shown only to a buyer who
 * holds more than one, because the summary API answers in one asset at a time.
 * Picking reloads the page: every figure on it was fetched for the old asset.
 */
export function DisplayAssetSelect() {
  const { chains } = useChains();
  const held = useQuery({ queryKey: ["held-assets"], queryFn: heldAssets, staleTime: 60_000 });
  const assets = held.data ?? [];
  const current = pickDisplayAsset(assets, storedDisplayAsset());
  if (!current) return null;

  return (
    <label className="flex w-full flex-wrap items-center gap-2 text-body-13 text-02">
      You hold more than one asset. Figures for a period are shown in
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
