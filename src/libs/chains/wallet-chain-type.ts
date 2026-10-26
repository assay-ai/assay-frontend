import { namespaceOf } from "./registry";

/**
 * Which wallets a wallet prompt should offer, from the chains this deployment
 * serves (`GET /chains`) — never from a constant. Today only `eip155` is
 * configured, so a Solana wallet is not offered where it could not be used;
 * the day a Solana chain is served again, it comes back with no code change.
 *
 * An empty or unread list offers both, as before: hiding every wallet because
 * the chain list has not loaded would strand the user.
 */
export type WalletChainType = "ethereum-only" | "solana-only" | "ethereum-and-solana";

export function servedNamespaces(chains: readonly { chainId: string; namespace?: string }[]): Set<string> {
  return new Set(chains.map((chain) => chain.namespace || namespaceOf(chain.chainId)));
}

export function walletChainTypeFor(chains: readonly { chainId: string; namespace?: string }[]): WalletChainType {
  const served = servedNamespaces(chains);
  const evm = served.has("eip155");
  const solana = served.has("solana");
  if (evm && !solana) return "ethereum-only";
  if (solana && !evm) return "solana-only";
  return "ethereum-and-solana";
}
