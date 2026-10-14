"use client";

import * as React from "react";

import { chainName } from "@/utils/chain";

import { useChains } from "./useChains";

/**
 * `chainName` with the served chain list wired in: `const name = useChainName();
 * name("eip155:46630")` → "Robinhood Chain testnet" once `GET /chains` lands,
 * the short CAIP-2 label before that (and if it fails).
 */
export function useChainName(): (chainId: string | null | undefined) => string {
  const { chains } = useChains();
  return React.useCallback((chainId: string | null | undefined) => chainName(chainId, chains), [chains]);
}
