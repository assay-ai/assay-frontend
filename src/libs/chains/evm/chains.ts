import { defineChain, type Chain as ViemChain } from "viem";

import strictRpcOrigins from "@/config/strict-rpc-origins.json";
import type { Chain } from "@/interfaces/chain";

import { PINNED_STAKE } from "./stake-slashes/deployments";

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

/** `http://localhost:*` and `http://127.0.0.1:*`: a local chain, accepted outside production builds only. */
const LOOPBACK_RPC = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * The RPC this browser uses for `chain`, or `null` (security review
 * 2026-11-09, F4). The served `publicRpcUrl` fills nonces, gas and fees and
 * reads allowances and receipts, so only an origin on the pinned list
 * (`src/config/strict-rpc-origins.json`, the same list the strict CSP allows)
 * is taken; a non-production build also takes a loopback RPC (a local chain).
 * Anything else falls back to the RPC pinned for that chain in this bundle,
 * or none.
 */
export function trustedRpcUrl(chain: Pick<Chain, "chainId" | "publicRpcUrl">): string | null {
  const served = chain.publicRpcUrl;
  if (served) {
    try {
      const url = new URL(served);
      if (url.protocol === "https:" && strictRpcOrigins.includes(url.origin)) return served;
      if (process.env.NEXT_PUBLIC_EVM_DEPLOYMENT !== "production" && LOOPBACK_RPC.test(url.origin)) return served;
    } catch {
      /* not a URL: the pinned one below, if any */
    }
  }
  return chain.chainId === PINNED_STAKE.chainId ? PINNED_STAKE.rpcUrl : null;
}

/** Seeded once by `Providers` from the server-fetched chain list. */
export function setEvmRpcUrls(chains: readonly Chain[]): void {
  rpcUrls.clear();
  for (const chain of chains) {
    const url = chain.namespace === "eip155" && chain.publicRpcUrl ? trustedRpcUrl(chain) : null;
    if (url) rpcUrls.set(chain.chainId, url);
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
  return chains.flatMap((chain) => {
    const url = chain.namespace === "eip155" && chain.publicRpcUrl ? trustedRpcUrl(chain) : null;
    if (!url) return [];
    return [
      defineChain({
        id: evmChainNumber(chain.chainId),
        name: chain.displayName,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [url] } },
      }),
    ];
  });
}
