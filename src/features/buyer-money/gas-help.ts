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

/**
 * Where a buyer gets the test dollar token itself, on a test network; `null`
 * on a main network. No faucet URL is served for tokens, so this names the
 * chain's faucet (the demo chain's settlement token is the one its faucet
 * mints, see `libs/chains/demo-chains.ts`).
 */
export function testTokenHelp(
  chain: (Pick<Chain, "displayName" | "chainId"> & { settlementAssetSymbol?: string }) | null | undefined,
): string | null {
  if (!chain || !isTestnet(chain)) return null;
  const symbol = chain.settlementAssetSymbol || "the test token";
  return `No ${symbol}? On this test network it has no real value: get some from the ${chain.displayName} faucet.`;
}

/**
 * What a first deposit takes on a test network, in one line, for a screen
 * that sends someone to "Add funds" (the public-name claim): the minimum, the
 * test dollar token and a little ETH for gas, both from the chain's faucet.
 * `null` on a main network. No faucet URL is served, so none is linked.
 */
export function testnetDepositLine(
  chain: (Pick<Chain, "displayName" | "chainId"> & { settlementAssetSymbol?: string }) | null | undefined,
  minimumUsd: string,
): string | null {
  if (!chain || !isTestnet(chain)) return null;
  const symbol = chain.settlementAssetSymbol || "the test token";
  const gas = isEvmChain(chain.chainId) ? " plus a little ETH for gas" : "";
  return `On ${chain.displayName} that is at least $${minimumUsd} in ${symbol}${gas}. Test tokens have no real value: get them free from the ${chain.displayName} faucet first.`;
}
