import type { Chain, GetChainsResponse } from "@/interfaces/chain";
import { demoChains } from "@/libs/chains/demo-chains";
import { chainLabel } from "@/utils/chain";

import { api } from "./api";

/**
 * `GET /chains` — which chains this deployment offers.
 *
 * Unauthenticated, and the same four strings and a number for every caller.
 * The deposit chain picker, the balance cards and the wallet menu all render
 * from this response and **never** from a constant in this bundle: a
 * build-time copy drifts from `ENABLED_CHAINS`, and the failure it produces is
 * a user offered a chain the API then refuses at the moment they try to move
 * money.
 *
 * **The route exists.** `ChainsController` at
 * `src/modules/chains/controllers/chains.controller.ts` in assay-backend
 * declares `@Controller('chains')` and returns `GetChainsResponseDto`, built by
 * `ChainDirectoryService` from the `ENABLED_CHAINS` token alone. Older backend
 * versions do not have it.
 *
 * So `useChains` reaches **ready**, and `error` is a failure path rather than
 * the state this deployment lives in. It still carries an EMPTY list in both
 * non-ready states, because a seeded default is the
 * build-time copy, one render deep.
 *
 * The route sets `max-age=60, must-revalidate` with NO stale window on purpose
 * (that controller's own doc comment argues it at length), so a browser cannot
 * paint yesterday's list while the API is down. Nothing on this side may widen
 * it back with a long React Query `staleTime`.
 */
export function getChains(): Promise<GetChainsResponse> {
  /*
    The demo escape hatch, and the ONLY caller of `demoChains()`. It answers
    `null` unless `NEXT_PUBLIC_DEMO_CHAINS=robinhood` was inlined at build
    time, so a normal build still asks the API and everything above this line
    still holds. See `libs/chains/demo-chains.ts` for why it exists and what
    deletes it.
  */
  const demo = demoChains();
  if (demo !== null) return Promise.resolve({ chains: [...demo] });
  return api.get<GetChainsResponse>("/chains");
}

/** The chain with this id, or `null`. Never `chains[0]`, which is the two-chain bug. */
export function findChain(chains: readonly Chain[], chainId: string): Chain | null {
  return chains.find((chain) => chain.chainId === chainId) ?? null;
}

/**
 * A chain's name for people.
 *
 * Falls back to the CAIP-2 label — `solana:EtWT…`, `eip155:4663` — and never
 * to the namespace alone, which would collapse mainnet and devnet into one
 * word on screens where that difference is whether the money is real.
 */
export function chainDisplayName(chains: readonly Chain[], chainId: string): string {
  return findChain(chains, chainId)?.displayName ?? chainLabel(chainId);
}

/**
 * The ticker this chain settles in — `USDC`, `USDG` — or `null`.
 *
 * `null`, never a default, and above all never `chains[0].settlementAssetSymbol`:
 * with two chains enabled the first one is Solana and its answer is `USDC`,
 * which is the literal this function exists to delete. A symbol is a claim
 * about which token a buyer is about to send; the honest answer when the chain
 * list has not arrived is that we do not know yet, and every caller here has a
 * rendering for that.
 *
 * It is deliberately not derived from `settlementAsset`. `eip155:46630/erc20:
 * 0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec` contains no ticker, and the only
 * way to get one on this side is a chain-id → symbol table — a build-time
 * copy in miniature, and it would be wrong the first time an operator points a
 * devnet at a different mint.
 */
export function settlementSymbol(chains: readonly Chain[], chainId: string): string | null {
  return findChain(chains, chainId)?.settlementAssetSymbol ?? null;
}

/**
 * A CAIP-19 asset, short enough for a card: the ticker when it is a chain's
 * settlement asset, else the start of its own id — never another asset's name.
 */
export function assetName(chains: readonly Chain[], asset: string): string {
  const chain = chains.find((c) => c.settlementAsset === asset);
  if (chain) return chain.settlementAssetSymbol;
  const reference = asset.slice(asset.lastIndexOf(":") + 1);
  return reference.length > 10 ? `${reference.slice(0, 8)}…` : reference;
}
