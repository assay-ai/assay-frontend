import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type PublicClient,
} from "viem";

import type { Eip155UnsignedTransaction } from "@/interfaces/chain-transaction";

import { evmRpcUrl } from "./chains";

/**
 * The eip155 half of the deposit: `approve(escrow, amount)` on the token, then
 * `depositFor(buyer, amount)` on the escrow — the two calls `POST /deposits`
 * names in its `eip155` requirements.
 *
 * ## Why the browser fills nonce, gas and fees itself
 *
 * Privy's embedded wallet signs in an iframe on Privy's own origin, and asking
 * it to fill a transaction means that iframe calls the RPC. For a deployment
 * whose RPC is private — or a local node on 127.0.0.1 — a public origin calling
 * it is exactly what Chrome's Private Network Access refuses. Filling here, from
 * this page's origin, leaves Privy nothing to do but sign, and makes the bytes
 * the buyer approves fully determined before the prompt opens.
 *
 * ## `depositFor` is signed and NOT sent
 *
 * `POST /deposits/:id/settle` takes the signed bytes, `EvmFacilitator` verifies
 * them (signer, call, amount, a simulation) and broadcasts them — the x402
 * `exact` shape the Solana deposit already has. `approve` has no such consumer,
 * so the browser broadcasts it: it is the buyer's own transaction to their own
 * token, and the platform has no business submitting it.
 */

/** The two calls, and nothing else — a partial ABI, like the backend's vendored one. */
const DEPOSIT_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function depositFor(address buyer, uint64 amount)",
]);

/**
 * Gas is estimated, then padded. An estimate is exact for the state it ran
 * against, and one block later a storage slot the call writes may have gone
 * from zero to non-zero; a transaction that runs out of gas reverts and still
 * spends it. 20% is the margin, not a guess at the price.
 */
const GAS_MARGIN_PERCENT = 120n;

/**
 * Upper bounds on what the RPC may ask a wallet to pay (frontend review
 * 2026-10-15, F4). The RPC comes from `GET /chains`; a hostile one could
 * answer a fee that burns the embedded wallet's whole balance. Every call this
 * app sends costs well under a million gas, and the pinned chain's fees are a
 * fraction of a gwei, so a value above these is refused, not signed.
 */
export const MAX_FEE_PER_GAS_WEI = 50_000_000_000n; // 50 gwei
export const MAX_GAS_LIMIT = 3_000_000n;

/** Throws when a filled transaction's gas limit or fees exceed the bounds above. */
export function assertSaneFees(tx: Pick<Eip155UnsignedTransaction, "gasLimit" | "maxFeePerGas" | "maxPriorityFeePerGas">): void {
  const fee = BigInt(tx.maxFeePerGas);
  if (BigInt(tx.gasLimit) > MAX_GAS_LIMIT || fee > MAX_FEE_PER_GAS_WEI || BigInt(tx.maxPriorityFeePerGas) > fee) {
    throw new Error(
      `The network asked for a gas limit of ${tx.gasLimit} at up to ${tx.maxFeePerGas} wei per gas, ` +
        "more than any transaction here needs. Nothing was sent; try again later.",
    );
  }
}

export function encodeApprove(spender: string, amountAtomic: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: DEPOSIT_ABI,
    functionName: "approve",
    args: [getAddress(spender), amountAtomic],
  });
}

export function encodeDepositFor(buyer: string, amountAtomic: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: DEPOSIT_ABI,
    functionName: "depositFor",
    args: [getAddress(buyer), amountAtomic],
  });
}

function clientFor(chainId: string): PublicClient {
  const url = evmRpcUrl(chainId);
  if (url === null) {
    throw new Error(
      `No public RPC is configured for ${chainId} (the backend's GET /chains returned none). Nothing was sent.`,
    );
  }
  return createPublicClient({ transport: http(url) }) as PublicClient;
}

export interface DepositReadiness {
  /** Native balance, wei — pays the gas for both transactions. */
  readonly nativeWei: bigint;
  /** Settlement-token balance, atomic units. */
  readonly tokenAtomic: bigint;
  /** What `spender` may already pull, atomic units. `approve` is skipped when enough. */
  readonly allowanceAtomic: bigint;
}

export async function readDepositReadiness(input: {
  chainId: string;
  owner: string;
  token: string;
  spender: string;
}): Promise<DepositReadiness> {
  const client = clientFor(input.chainId);
  const owner = getAddress(input.owner);
  const token = getAddress(input.token);
  const [nativeWei, tokenAtomic, allowanceAtomic] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({
      address: token,
      abi: DEPOSIT_ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    client.readContract({
      address: token,
      abi: DEPOSIT_ABI,
      functionName: "allowance",
      args: [owner, getAddress(input.spender)],
    }),
  ]);
  return { nativeWei, tokenAtomic, allowanceAtomic };
}

/** Native balance alone — the check that can run before a deposit intent exists. */
export async function readNativeBalance(chainId: string, owner: string): Promise<bigint> {
  return clientFor(chainId).getBalance({ address: getAddress(owner) });
}

/**
 * A complete EIP-1559 transaction for the wallet to sign: nonce at `pending`,
 * padded gas estimate, and the node's fee suggestion.
 *
 * Estimation runs AS `from`, so a call that would revert — an `approve` that
 * has not landed, a balance that is short — throws here, before any prompt.
 */
export async function fillTransaction(input: {
  chainId: string;
  from: string;
  to: string;
  data: `0x${string}`;
}): Promise<Eip155UnsignedTransaction> {
  const client = clientFor(input.chainId);
  const from = getAddress(input.from);
  const to = getAddress(input.to);
  const [nonce, gas, fees] = await Promise.all([
    client.getTransactionCount({ address: from, blockTag: "pending" }),
    client.estimateGas({ account: from, to, data: input.data }),
    client.estimateFeesPerGas(),
  ]);
  const filled: Eip155UnsignedTransaction = {
    namespace: "eip155",
    chainId: input.chainId,
    kind: "transaction",
    from,
    to,
    data: input.data,
    value: "0",
    nonce: String(nonce),
    gasLimit: String((gas * GAS_MARGIN_PERCENT) / 100n),
    maxFeePerGas: String(fees.maxFeePerGas),
    maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
  };
  assertSaneFees(filled);
  return filled;
}

/** The most this transaction can cost in gas, wei. */
export function maxGasCostWei(tx: Eip155UnsignedTransaction): bigint {
  return BigInt(tx.gasLimit) * BigInt(tx.maxFeePerGas);
}

/**
 * Broadcast the buyer's own signed transaction and wait for it to be mined.
 *
 * Refuses a revert by name: an `approve` that reverted leaves the allowance
 * where it was, and the `depositFor` after it would only fail its simulation
 * with a less useful sentence.
 */
/** Broadcast signed bytes through the page's own RPC and return the hash, without waiting. */
export async function broadcast(
  chainId: string,
  rawTransaction: `0x${string}`,
): Promise<`0x${string}`> {
  return clientFor(chainId).sendRawTransaction({ serializedTransaction: rawTransaction });
}

export async function broadcastAndWait(
  chainId: string,
  rawTransaction: `0x${string}`,
): Promise<`0x${string}`> {
  const hash = await broadcast(chainId, rawTransaction);
  await waitForSuccess(chainId, hash);
  return hash;
}

/**
 * Waits for a transaction someone else broadcast — an injected wallet's
 * `eth_sendTransaction` — to be mined, and refuses a revert by name.
 */
export async function waitForSuccess(chainId: string, hash: `0x${string}`): Promise<void> {
  const receipt = await clientFor(chainId).waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  if (receipt.status !== "success") {
    throw new Error(`The transaction ${hash} reverted on ${chainId}. Nothing was deposited.`);
  }
}

/**
 * One look at a transaction, without waiting: `"pending"` until it is mined
 * (or while the RPC has not seen it), then `"success"` or `"reverted"`. For
 * picking a pending transaction back up after a reload.
 */
export async function readReceiptStatus(
  chainId: string,
  hash: `0x${string}`,
): Promise<"pending" | "success" | "reverted"> {
  try {
    const receipt = await clientFor(chainId).getTransactionReceipt({ hash });
    return receipt.status === "success" ? "success" : "reverted";
  } catch {
    return "pending";
  }
}
