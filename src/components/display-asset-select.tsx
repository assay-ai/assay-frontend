"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { useChains } from "@/hooks/useChains";
import type { Chain } from "@/interfaces/chain";
import {
  BALANCES_KEY,
  getBalances,
  pickDisplayAsset,
  providerEarningAssets,
  storeDisplayAsset,
  storedDisplayAsset,
} from "@/services";
import { assetsOfBalances, subscribeDisplayAsset } from "@/services/display-asset";

function selectHeldAssets(response: { balances: readonly { asset: string }[] }): string[] {
  return assetsOfBalances(response.balances ?? []);
}
import { assetName, chainDisplayName } from "@/services/chains.service";

/** `USDG on Robinhood Chain testnet`. */
export function displayAssetLabel(asset: string, chains: readonly Chain[]): string {
  return `${assetName(chains, asset)} on ${chainDisplayName(chains, asset.split("/")[0])}`;
}

type Scope = "buyer" | "provider";

/**
 * The stored pick, re-read whenever it changes. Put it in a query key (or an
 * effect's deps) so a screen refetches on a switch instead of reloading.
 */
export function useDisplayAssetPick(): string | null {
  return useSyncExternalStore(subscribeDisplayAsset, storedDisplayAsset, () => null);
}

/**
 * The asset the selector shows as picked, for a page that scopes its own rows
 * by it. `current` is `undefined` for a one-asset account; `isPending` is true
 * until that is known.
 */
export function useDisplayAsset(scope: Scope) {
  // A buyer's assets are a slice of the balances every money screen reads: one request, refreshed with them.
  const held = useQuery({
    queryKey: BALANCES_KEY,
    queryFn: getBalances,
    select: selectHeldAssets,
    enabled: scope === "buyer",
  });
  const earned = useQuery({
    queryKey: ["display-assets", scope],
    queryFn: providerEarningAssets,
    staleTime: 60_000,
    enabled: scope === "provider",
  });
  const query = scope === "buyer" ? held : earned;
  const assets = query.data ?? [];
  const stored = useDisplayAssetPick();
  return {
    assets,
    current: pickDisplayAsset(assets, stored),
    isPending: query.isPending,
  };
}

/**
 * Which asset this page's period figures are in — shown only to an account
 * with more than one, because the summary APIs answer in one asset at a time.
 * `scope` says whose assets: what a buyer holds, or what a provider earned in.
 * With `live`, picking only stores the choice and the page refetches (its
 * loaders key on `useDisplayAssetPick()`); without it, the page reloads,
 * because every figure on it was fetched for the old asset.
 */
export function DisplayAssetSelect({ scope = "buyer", live = false }: { scope?: Scope; live?: boolean }) {
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
          if (!live) window.location.reload();
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
