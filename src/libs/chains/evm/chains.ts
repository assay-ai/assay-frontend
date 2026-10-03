import { defineChain, type Chain as ViemChain } from "viem";

import type { Chain } from "@/interfaces/chain";

/**
 * The eip155 chains this browser can sign for, and the RPC each one is read
 * through — **from `GET /chains`**, never from a list in the code.
 *
 * ## Why it is served rather than built in
 *
 * A build-time `NEXT_PUBLIC_*` variable would fix the endpoint into the bundle
 * at build time, separately from the deployment that decides which chains are
 * enabled. So the endpoint travels with the chain list, which is where every other
 * chain fact already comes from — and the backend only serves one it has been
 * told is public (`PUBLIC_RPC_URLS`), never the keyed URL it reads the chain
 * through itself.
 *
 * ## Why it is a module-level registry
 *
 * Privy's `supportedChains` is read once, when `PrivyProvider` mounts, and
 * without it the embedded wallet never opens a prompt at all — measured: the
 * deposit screen sat on "Approving the token in your wallet…" for ever, with no
 * modal and no error. So the list has to exist before the first render, which
 * means the server fetches it in `app/layout.tsx` and `Providers` seeds it
 * here on the way past.
 */
const rpcUrls = new Map<string, string>();

/** Seeded once by `Providers` from the server-fetched chain list. */
export function setEvmRpcUrls(chains: readonly Chain[]): void {
  rpcUrls.clear();
  for (const chain of chains) {
    if (chain.namespace === "eip155" && chain.publicRpcUrl) {
      rpcUrls.set(chain.chainId, chain.publicRpcUrl);
    }
  }
}

/** The public RPC for this chain, or `null` when this deployment names none. */
export function evmRpcUrl(chainId: string): string | null {
  return rpcUrls.get(chainId) ?? null;
}

/** CAIP-2 `eip155:46630` → `46630`, the number every EVM API wants. */
export function evmChainNumber(chainId: string): number {
  return Number(chainId.slice(chainId.indexOf(":") + 1));
}

/**
 * viem `Chain` objects for Privy's `supportedChains`.
 *
 * Only what signing needs: the id and an RPC. The name is the chain's own
 * `displayName` from the API — nothing user-facing reads it, and a second,
 * hardcoded name here is a copy that would drift.
 */
export function evmChainsFrom(chains: readonly Chain[]): ViemChain[] {
  return chains
    .filter((chain) => chain.namespace === "eip155" && chain.publicRpcUrl)
    .map((chain) =>
      defineChain({
        id: evmChainNumber(chain.chainId),
        name: chain.displayName,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [chain.publicRpcUrl as string] } },
      }),
    );
}
