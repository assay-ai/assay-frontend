"use client";

import { walletChainTypeFor, type WalletChainType } from "@/libs/chains/wallet-chain-type";

import { useChains } from "./useChains";

/** The `walletChainType` for Privy's connect prompt, from the served chains. */
export function useWalletChainType(): WalletChainType {
  const { chains } = useChains();
  return walletChainTypeFor(chains);
}
