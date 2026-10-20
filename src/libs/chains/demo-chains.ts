import type { Chain } from "@/interfaces/chain";
import { demoEnabled } from "@/libs/demo/demo-api";

/**
 * A DEMO-ONLY chain list, for showing the Robinhood Chain surface before the
 * backend can serve it.
 *
 * Everything in `libs/chains/registry.ts` argues that a build-time chain list
 * drifts from the deployment, and that argument still holds — this file is the
 * exception it warns about, and it is switched off unless
 * `NEXT_PUBLIC_DEMO_CHAINS=robinhood` is inlined at build time. With the flag
 * unset, `getChains()` asks the API exactly as before and this module is dead
 * code.
 *
 * Why it exists: a backend that predates `GET /chains` answers 404, so
 * every chain-aware screen renders its `error` state and the deployment looks
 * broken rather than single-chain. Wherever the backend's `ENABLED_CHAINS`
 * names `eip155:46630`, the real route is better than this in every way,
 * because it cannot disagree with what the API will accept.
 *
 * The values are the ones in the EVM deployment record; the
 * token is the USDG the 46630 faucet mints.
 */
export const ROBINHOOD_TESTNET: Chain = {
  chainId: "eip155:46630",
  namespace: "eip155",
  displayName: "Robinhood Chain testnet",
  explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
  settlementAsset: "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec",
  settlementAssetSymbol: "USDG",
  decimals: 6,
};

/**
 * The chain list this build should pretend the API returned, or `null` when
 * the flag is unset — which is every build that is not a demo.
 *
 * `NEXT_PUBLIC_*` is inlined at build time, so this is a property of the
 * build, not something runtime configuration can flip afterwards.
 */
export function demoChains(): readonly Chain[] | null {
  return demoEnabled() ? [ROBINHOOD_TESTNET] : null;
}

/** The one chain id this demo build pretends the deployment settles on. */
export function demoChainId(): string | null {
  return demoChains() === null ? null : ROBINHOOD_TESTNET.chainId;
}

/**
 * Stamp the demo chain onto rows that predate it — DEMO ONLY, and a no-op
 * without the flag.
 *
 * `GET /balances` on this deployment is older than the per-chain ledger, so its
 * rows carry no `chainId` and no `chainReadable`. Left alone, the balance cards
 * render one card with an empty name and every chain-derived figure as
 * "Unknown", which reads as an outage rather than as a demo. The money figures
 * themselves are the API's own and are NOT touched here.
 */
export function withDemoChain<T extends { chainId?: string; chainReadable?: boolean }>(
  rows: readonly T[],
): T[] {
  const chainId = demoChainId();
  if (chainId === null) return [...rows];
  return rows.map((row) => ({
    ...row,
    chainId: row.chainId === undefined || row.chainId === "" ? chainId : row.chainId,
    chainReadable: row.chainReadable ?? true,
  }));
}
