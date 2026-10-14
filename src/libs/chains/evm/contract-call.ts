import { createPublicClient, getAddress, http, isAddress, type PublicClient } from "viem";

import { evmRpcUrl } from "./chains";

/**
 * Small chain reads for sending one of the backend's unsigned contract calls
 * (`SlashContractCall`): address equality and waiting for the receipt. The
 * fill (nonce, gas, fees) is `fillTransaction` in `deposit-transaction.ts`;
 * the signing is `useSigner`.
 */

/** True when both are EVM addresses and name the same account, whatever their case. */
export function sameEvmAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (!isAddress(a, { strict: false }) || !isAddress(b, { strict: false })) return false;
  return getAddress(a) === getAddress(b);
}

function clientFor(chainId: string): PublicClient {
  const url = evmRpcUrl(chainId);
  if (url === null) {
    throw new Error(
      `No public RPC is configured for ${chainId} (the backend's GET /chains returned none), so the receipt cannot be read.`,
    );
  }
  return createPublicClient({ transport: http(url) }) as PublicClient;
}

/**
 * Waits for a sent contract call to be mined and refuses a revert by name.
 * The hash is the wallet's; the receipt is read through the page's own RPC.
 */
export async function waitForContractCall(
  chainId: string,
  hash: `0x${string}`,
  functionName: string,
): Promise<void> {
  const receipt = await clientFor(chainId).waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") {
    throw new Error(`The ${functionName} transaction ${hash} reverted on ${chainId}. Nothing changed on chain.`);
  }
}
