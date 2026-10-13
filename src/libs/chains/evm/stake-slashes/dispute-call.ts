import { encodeFunctionData, getAddress, isAddress, parseAbi, type Hex } from "viem";

import type { StakeDeployment } from "./deployments";

/**
 * Checks the backend's unsigned `disputeSlashBatch` against what this page
 * pinned and what the provider selected, before any wallet is asked to sign.
 *
 * This page exists for the case where Assay's backend cannot be trusted, and a
 * dispute is the provider protecting their stake from exactly that. So the
 * transaction the backend hands back is not sent on its word: it must go to the
 * PINNED stake contract on the pinned chain, from the provider's own wallet,
 * with no value, and its calldata must be byte-for-byte
 * `disputeSlashBatch(ids)` for the very ids that were selected. Anything else
 * is refused, and nothing is signed.
 */

const DISPUTE_ABI = parseAbi(["function disputeSlashBatch(bytes32[] requestIds)"]);

export function encodeDisputeSlashBatch(requestIds: readonly string[]): Hex {
  return encodeFunctionData({
    abi: DISPUTE_ABI,
    functionName: "disputeSlashBatch",
    args: [requestIds.map((id) => id.toLowerCase() as Hex)],
  });
}

export interface DisputeCallLike {
  readonly chainId: string;
  readonly to: string;
  readonly data: string;
  readonly value: string;
  readonly signer: string;
  readonly signerRole: string;
  readonly requestIds: readonly string[];
}

/** `null` when the call is exactly the dispute that was asked for; otherwise why it is not. */
export function disputeCallMismatch(
  call: DisputeCallLike,
  deployment: StakeDeployment,
  provider: string,
  selected: readonly string[],
): string | null {
  if (call.chainId !== deployment.chainId) {
    return `it is for ${call.chainId}, not ${deployment.chainId}`;
  }
  if (!isAddress(call.to, { strict: false }) || getAddress(call.to) !== getAddress(deployment.stakeContract)) {
    return `it is addressed to ${call.to}, not the stake contract ${deployment.stakeContract}`;
  }
  if (
    call.signerRole !== "PROVIDER" ||
    !isAddress(call.signer, { strict: false }) ||
    getAddress(call.signer) !== getAddress(provider)
  ) {
    return `it names ${call.signer} (${call.signerRole}) as the sender, not your stake wallet ${provider}`;
  }
  if (call.value !== "0") return `it carries a value of ${call.value}`;

  const wanted = new Set(selected.map((id) => id.toLowerCase()));
  const carried = call.requestIds.map((id) => id.toLowerCase());
  if (carried.length !== wanted.size || carried.some((id) => !wanted.has(id))) {
    return "it carries other penalties than the ones you selected";
  }
  if (call.data.toLowerCase() !== encodeDisputeSlashBatch(carried).toLowerCase()) {
    return "its calldata is not disputeSlashBatch of the penalties you selected";
  }
  return null;
}
