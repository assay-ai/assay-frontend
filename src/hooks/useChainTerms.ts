"use client";

import { createContext, useContext, useMemo } from "react";

import type { Chain, ChainParams } from "@/interfaces/chain";
import { type ChainTerms, chainTerms, termsChain } from "@/libs/chain-terms";

/**
 * The `GET /chains` list, as `ChainsGate` (providers/index.tsx) last read it.
 * A context rather than a second `useChains()` in every `<Term>`: a leaf that
 * prints a chain value needs no query client of its own, and outside the app
 * (a unit render) it reads "—", never a guess.
 */
export const ChainListContext = createContext<readonly Chain[]>([]);

export interface UseChainTermsResult {
  chain: Chain | null;
  /** The raw on-chain params, for arithmetic; `null` until `GET /chains` answered. */
  params: ChainParams | null;
  /** The same, as text; each value reads "—" until known. */
  terms: ChainTerms;
}

/** The on-chain terms of `chainId`, or of the deployment's chain with params when none is named. */
export function useChainTerms(chainId?: string | null): UseChainTermsResult {
  const chains = useContext(ChainListContext);
  return useMemo(() => {
    const chain = termsChain(chains, chainId);
    return { chain, params: chain?.params ?? null, terms: chainTerms(chain) };
  }, [chains, chainId]);
}
