import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

import { SOLANA_DEVNET_RPC_URL, SOLANA_DEVNET_WS_URL } from "./chains";

/**
 * The Solana RPC clients Privy needs in order to sign, built HERE rather than
 * in `providers/index.tsx`.
 *
 * The chain-SDK boundary (`eslint.config.mjs`, `assay/chain-sdk-boundary`) says
 * `@solana/*` may be imported only under the chain library. `providers/index.tsx`
 * was the one non-library file importing `@solana/kit`, and the cheapest way to
 * make the boundary hold was an exemption for that file — which is exactly the
 * hole the rule exists to close, in the file most likely to gain a SECOND
 * namespace's client. So the construction moved instead. The provider now
 * declares WHICH chains it configures; it no longer knows how a client is made.
 *
 * The return type is deliberately inferred: naming it would require importing
 * Privy's config types here, and this module has no business knowing who its
 * caller is.
 */
export function solanaDevnetRpc() {
  return {
    rpc: createSolanaRpc(SOLANA_DEVNET_RPC_URL),
    rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_DEVNET_WS_URL),
  };
}
