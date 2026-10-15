import type { Signer } from "@/hooks/useSigner";
import {
  broadcastAndWait,
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

export async function signEvmDeposit(input: {
  signer: Signer;
  requirements: EvmDepositRequirements;
  amountAtomic: bigint;
  /** Called when the approve transaction goes to the wallet, so the button can say so. */
  onApproving?: () => void;
}): Promise<EvmDepositSubmission> {
  const { signer, requirements, amountAtomic } = input;
  const chainId = requirements.chainId;

  // `depositFor` pulls from msg.sender, and the settle route refuses a signer
  // who is not the buyer credited. Say it here, where it can be fixed.
  if (signer.address.toLowerCase() !== requirements.buyer.toLowerCase()) {
    throw new EvmDepositRefused(
      `This deposit credits ${requirements.buyer}, but the connected wallet is ${signer.address}. ` +
        `Nothing was sent.`,
    );
  }
  // What the API asked for, not what the screen computed: a mismatch is a bug
  // somewhere, and signing either number would be signing a guess.
  if (BigInt(requirements.amount) !== amountAtomic) {
    throw new EvmDepositRefused(
      "The deposit amount changed while it was being prepared. Nothing was sent.",
    );
  }

  // The API names the token, the spender and the escrow; the approval is only
  // ever for the pinned token and the pinned escrow (frontend review
  // 2026-10-15, F1), or a compromised API could aim it at itself.
  const pinned = pinnedDeployment(chainId);
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

  const readiness = await readDepositReadiness({
    chainId,
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

  let nativeLeft = readiness.nativeWei;
  if (readiness.allowanceAtomic < amountAtomic) {
    const approve = await fillTransaction({
      chainId,
      from: signer.address,
      to: requirements.asset,
      data: encodeApprove(requirements.spender, amountAtomic),
    });
    if (maxGasCostWei(approve) > nativeLeft) {
      throw new EvmDepositRefused(
        "This wallet does not hold enough ETH for the network fee. Add a little ETH and retry. Nothing was sent.",
      );
    }
    input.onApproving?.();
    if (signer.kind === "external") {
      // An injected wallet signs and sends in one step; wait for it to land,
      // because `depositFor` reverts in estimation until the allowance exists.
      await waitForSuccess(chainId, (await signer.signAndSend(approve)) as `0x${string}`);
    } else {
      const signedApprove = await signer.signTransaction(approve);
      if (signedApprove.namespace !== "eip155") {
        throw new Error(`Expected an eip155 signature, got ${signedApprove.namespace}.`);
      }
      await broadcastAndWait(chainId, signedApprove.rawTransaction);
    }
    nativeLeft -= maxGasCostWei(approve);
  }

  // Estimated only now: before the approval is mined, `depositFor` reverts in
  // estimation and there is nothing to estimate.
  const deposit = await fillTransaction({
    chainId,
    from: signer.address,
    to: requirements.contract,
    data: encodeDepositFor(requirements.buyer, amountAtomic),
  });
  if (maxGasCostWei(deposit) > nativeLeft) {
    throw new EvmDepositRefused(
      "This wallet does not hold enough ETH for the network fee. Add a little ETH and retry. " +
        "Your approval is kept, so the next attempt asks for one signature.",
    );
  }
  if (signer.kind === "external") {
    /*
      Sent by the wallet itself, then waited on: the backend reads this
      transaction's receipt at `confirmed`, and a hash reported before it is
      mined would be read as "no transfer" and fail the deposit.
    */
    const transactionHash = (await signer.signAndSend(deposit)) as `0x${string}`;
    await waitForSuccess(chainId, transactionHash);
    return { kind: "broadcast", transactionHash };
  }
  const signed = await signer.signTransaction(deposit);
  if (signed.namespace !== "eip155") {
    throw new Error(`Expected an eip155 signature, got ${signed.namespace}.`);
  }
  return { kind: "signed", rawTransaction: signed.rawTransaction };
}
