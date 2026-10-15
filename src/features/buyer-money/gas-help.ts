import type { Chain } from "@/interfaces/chain";
import { isEvmChain } from "@/libs/chains/registry";

/**
 * Where a buyer gets the ETH an eip155 transaction costs, when the chain is a
 * test network (a new buyer without testnet ETH otherwise hits a wall at
 * "You pay gas"). Main networks get nothing: buying ETH is not ours to explain.
 *
 * The chain list has no faucet field today; `faucetUrl` is read if a backend
 * ever serves one, and the help is plain text until then.
 */
export interface GasHelp {
  text: string;
  faucetUrl: string | null;
}

export function isTestnet(chain: Pick<Chain, "displayName" | "chainId"> | null | undefined): boolean {
  if (!chain) return false;
  return /testnet|devnet|sepolia|goerli/i.test(chain.displayName);
}

export function gasHelp(chain: (Pick<Chain, "displayName" | "chainId"> & { faucetUrl?: string }) | null | undefined): GasHelp | null {
  if (!chain || !isEvmChain(chain.chainId) || !isTestnet(chain)) return null;
  const faucetUrl = typeof chain.faucetUrl === "string" && /^https:\/\//.test(chain.faucetUrl) ? chain.faucetUrl : null;
  return {
    text: faucetUrl
      ? `No ETH for gas? Testnet ETH is free from the ${chain.displayName} faucet.`
      : `No ETH for gas? Testnet ETH is free: get some from the ${chain.displayName} faucet (search “${chain.displayName} faucet”) and send it to your wallet first.`,
    faucetUrl,
  };
}
