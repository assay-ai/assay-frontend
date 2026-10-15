import type { Signer } from "@/hooks/useSigner";
import {
  broadcast,
  encodeApprove,
  encodeDepositFor,
  fillTransaction,
  maxGasCostWei,
  readDepositReadiness,
  waitForSuccess,
} from "@/libs/chains/evm/deposit-transaction";
import { pinnedDeployment } from "@/libs/chains/evm/signing-guard";
import type { EvmDepositRequirements } from "@/services/funding.service";

/**
 * The eip155 deposit, from requirements to the signed `depositFor` the settle
 * route takes.
 *
 * ```
 * read ETH, token balance, allowance
 *   -> allowance short?  approve(spender, amount): sign, broadcast, wait mined
 *   -> depositFor(buyer, amount): sign, hand back UNSENT        (embedded wallet)
 *                                 or: the wallet SENDS it, hash back  (injected wallet)
 * ```
 *
 * Every refusal is a sentence the buyer can act on, raised **before** the
 * wallet is asked for anything it would be pointless to sign. The backend
 * refuses all of these too (`EvmFacilitator`), but a refusal after a prompt
 * costs the buyer an approval — and for `approve`, real gas.
 *
 * `approve` is for exactly `amount`, never unlimited: an unlimited allowance to
 * a contract is standing permission to take the whole balance, and one more
 * prompt per deposit is the cheaper side of that trade.
 */
export class EvmDepositRefused extends Error {}

/**
 * What the deposit screen hands the backend, by wallet kind.
 *
 * - `signed` — the embedded wallet signed `depositFor` UNSENT; it goes to
 *   `POST /deposits/:id/settle` and `EvmFacilitator` broadcasts it.
 * - `broadcast` — an injected wallet (MetaMask, Rabby, …) cannot sign without
 *   sending, so it SENT `depositFor` itself; the hash goes to
 *   `POST /deposits/:id/broadcast`, where the backend reads it off the chain.
 */
export type EvmDepositSubmission =
  | { readonly kind: "signed"; readonly rawTransaction: `0x${string}` }
  | { readonly kind: "broadcast"; readonly transactionHash: `0x${string}` };

export interface EvmDepositInput {
  signer: Signer;
  requirements: EvmDepositRequirements;
  amountAtomic: bigint;
  /** Called with the hash the moment a transaction is broadcast, before the wait. */
  onSubmitted?: (hash: `0x${string}`) => void;
}

/**
 * The API names the token, the spender and the escrow; the approval and the
 * deposit are only ever for the pinned token and the pinned escrow (frontend
 * review 2026-10-15, F1), or a compromised API could aim them at itself.
 * Checked by each step below, since the Add funds drawer runs them one by one.
 */
function assertPinnedDeposit(requirements: EvmDepositRequirements): void {
  const pinned = pinnedDeployment(requirements.chainId);
  const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  if (
    !same(requirements.asset, pinned.settlementToken) ||
    !same(requirements.spender, pinned.escrowContract) ||
    !same(requirements.contract, pinned.escrowContract)
  ) {
    throw new EvmDepositRefused(
      "This deposit names another token or escrow than the ones this app knows for this chain. Nothing was sent.",
    );
  }
}

/**
 * Every refusal that can be raised before a prompt: wrong wallet, amount
 * drift, not enough token, no ETH. Returns what the steps below need.
 */
export async function checkEvmDeposit(input: Omit<EvmDepositInput, "onSubmitted">): Promise<{
  needsApprove: boolean;
  nativeWei: bigint;
}> {
  const { signer, requirements, amountAtomic } = input;
  // `depositFor` pulls from msg.sender, and the settle route refuses a signer
  // who is not the buyer credited. Say it here, where it can be fixed.
  if (signer.address.toLowerCase() !== requirements.buyer.toLowerCase()) {
    throw new EvmDepositRefused(
      `This deposit credits ${requirements.buyer}, but the connected wallet is ${signer.address}. ` +
        `Nothing was sent.`,
    );
  }
  // What the API asked for, not what the screen computed.
  if (BigInt(requirements.amount) !== amountAtomic) {
    throw new EvmDepositRefused("The deposit amount changed while it was being prepared. Nothing was sent.");
  }
  assertPinnedDeposit(requirements);
  const readiness = await readDepositReadiness({
    chainId: requirements.chainId,
    owner: signer.address,
    token: requirements.asset,
    spender: requirements.spender,
  });
  if (readiness.tokenAtomic < amountAtomic) {
    throw new EvmDepositRefused(
      "This wallet does not hold enough of the settlement token for this deposit. Nothing was sent.",
    );
  }
  if (readiness.nativeWei === 0n) {
    throw new EvmDepositRefused(
      "This wallet has no ETH to pay the network fee, and a deposit on this chain is paid for by " +
        "the wallet that signs it. Add a little ETH and retry. Nothing was sent.",
    );
  }
  return { needsApprove: readiness.allowanceAtomic < amountAtomic, nativeWei: readiness.nativeWei };
}

/**
 * `approve(spender, amount)`: signed, broadcast and waited for, because
 * `depositFor` reverts in estimation until the allowance exists. For exactly
 * the amount, never unlimited.
 */
export async function approveEvmDeposit(input: EvmDepositInput & { nativeWei: bigint }): Promise<bigint> {
  const { signer, requirements, amountAtomic } = input;
  assertPinnedDeposit(requirements);
  const chainId = requirements.chainId;
  const approve = await fillTransaction({
    chainId,
    from: signer.address,
    to: requirements.asset,
    data: encodeApprove(requirements.spender, amountAtomic),
  });
  if (maxGasCostWei(approve) > input.nativeWei) {
    throw new EvmDepositRefused(
      "This wallet does not hold enough ETH for the network fee. Add a little ETH and retry. Nothing was sent.",
    );
  }
  let hash: `0x${string}`;
  if (signer.kind === "external") {
    hash = (await signer.signAndSend(approve)) as `0x${string}`;
  } else {
    const signedApprove = await signer.signTransaction(approve);
    if (signedApprove.namespace !== "eip155") {
      throw new Error(`Expected an eip155 signature, got ${signedApprove.namespace}.`);
    }
    hash = await broadcast(chainId, signedApprove.rawTransaction);
  }
  input.onSubmitted?.(hash);
  await waitForSuccess(chainId, hash);
  return input.nativeWei - maxGasCostWei(approve);
}

/**
 * `depositFor(buyer, amount)`: an embedded wallet signs it UNSENT (the settle
 * route broadcasts it); an injected wallet sends it itself and the hash is
 * settled once mined.
 */
export async function sendEvmDepositFor(input: EvmDepositInput & { nativeWei?: bigint }): Promise<EvmDepositSubmission> {
  const { signer, requirements, amountAtomic } = input;
  assertPinnedDeposit(requirements);
  const chainId = requirements.chainId;
  const deposit = await fillTransaction({
    chainId,
    from: signer.address,
    to: requirements.contract,
    data: encodeDepositFor(requirements.buyer, amountAtomic),
  });
  if (input.nativeWei !== undefined && maxGasCostWei(deposit) > input.nativeWei) {
    throw new EvmDepositRefused(
      "This wallet does not hold enough ETH for the network fee. Add a little ETH and retry. " +
        "Your approval is kept, so the next attempt asks for one signature.",
    );
  }
  if (signer.kind === "external") {
    const transactionHash = (await signer.signAndSend(deposit)) as `0x${string}`;
    input.onSubmitted?.(transactionHash);
    await waitForSuccess(chainId, transactionHash);
    return { kind: "broadcast", transactionHash };
  }
  const signed = await signer.signTransaction(deposit);
  if (signed.namespace !== "eip155") {
    throw new Error(`Expected an eip155 signature, got ${signed.namespace}.`);
  }
  return { kind: "signed", rawTransaction: signed.rawTransaction };
}

/** The whole deposit in one call: checks, `approve` when needed, then `depositFor`. */
export async function signEvmDeposit(input: EvmDepositInput & { onApproving?: () => void }): Promise<EvmDepositSubmission> {
  const check = await checkEvmDeposit(input);
  let nativeWei = check.nativeWei;
  if (check.needsApprove) {
    input.onApproving?.();
    nativeWei = await approveEvmDeposit({ ...input, nativeWei });
  }
  return sendEvmDepositFor({ ...input, nativeWei });
}
