/**
 * The wallet steps behind the Stake and Withdraw sheets, as `WalletStep`s for
 * `SignAction`: each one reports "submitted" with its explorer link before it
 * waits for the chain, and a retry after a submitted step re-checks that
 * transaction instead of sending a second one.
 *
 * Nothing here signs on the platform's behalf: the backend builds unsigned
 * bytes, the provider's own wallet signs and broadcasts (`Signer.signAndSend`).
 */

import type { WalletStep } from "@/components/patterns/wallet-steps";
import { signProofChallenge } from "@/features/provider-proof/sign-proof-challenge";
import type { Signer } from "@/hooks/useSigner";
import type { Chain } from "@/interfaces/chain";
import type { StakeIntent } from "@/interfaces/provider-stake";
import { assertStakeIntent, type StakeExpectation } from "@/features/provider-stake/run-stake-intent";
import { ApiError } from "@/libs/ApiClient";
import {
  broadcast,
  encodeApprove,
  fillTransaction,
  readDepositReadiness,
  waitForSuccess,
} from "@/libs/chains/evm/deposit-transaction";
import { pinnedDeployment } from "@/libs/chains/evm/signing-guard";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { plainApiError, plainError } from "@/libs/plain-language";
import {
  createStakeAuthorityChallenge,
  proveStakeAuthority,
} from "@/services/provider-stake-authority.service";
import {
  createOpenStakeIntent,
  createStakeDepositIntent,
  createStakeWithdrawIntent,
  createUnstakeIntent,
} from "@/services/provider-stake.service";

/** A link to a transaction, when the chain is known; never a guessed URL. */
export function txLink(chain: Pick<Chain, "explorerBaseUrl"> | null | undefined, hash: string): string | undefined {
  if (!chain?.explorerBaseUrl) return undefined;
  try {
    return explorerTxUrl(chain as Chain, hash);
  } catch {
    return undefined;
  }
}

const NOT_READY = "Your stake wallet is not connected in this browser. Connect it and try again.";

function need(signer: Signer | null): Signer {
  if (!signer) throw new Error(NOT_READY);
  return signer;
}

/** One sentence for whatever a stake step threw. The raw message stays under Details. */
export function describeStakeError(error: unknown): string {
  if (error instanceof ApiError) return plainApiError(error);
  if (error instanceof Error && error.message === NOT_READY) return NOT_READY;
  if (error instanceof Error && /reverted/i.test(error.message)) {
    return "The chain refused the transaction. Your stake did not change; the network fee may have been spent.";
  }
  if (error instanceof Error && /insufficient funds|exceeds balance/i.test(error.message)) {
    return "This wallet does not hold enough to pay for this (the amount or the network fee).";
  }
  return "That did not go through. Your stake did not change. You can try again.";
}

/** "Confirm this wallet holds your stake": challenge → sign (free) → prove. */
export function proveWalletStep(input: {
  chainId: string | null;
  address: string;
  signer: Signer | null;
  skip: boolean;
  onProved: (stakeAuthority: string) => void;
}): WalletStep {
  return {
    id: "prove",
    label: "Confirm this wallet holds your stake",
    cost: "free",
    skip: input.skip,
    run: async ({ report }) => {
      const signer = need(input.signer);
      if (!input.chainId) throw new Error(NOT_READY);
      report({ stage: "preparing" });
      const challenge = await createStakeAuthorityChallenge({ chainId: input.chainId, address: input.address });
      report({ stage: "wallet" });
      const signature = await signProofChallenge(signer, challenge, "STAKE_AUTHORITY");
      report({ stage: "preparing" });
      const proved = await proveStakeAuthority({ challengeId: challenge.challengeId, signature });
      input.onProved(proved.stakeAuthority);
      return { data: proved.stakeAuthority };
    },
  };
}

/**
 * Signs and sends one stake intent — only when it is the action and amount the
 * provider chose (`expected`) and, on EVM, exactly that call on the pinned
 * stake contract (frontend review 2026-10-15, F1: the API builds the bytes).
 */
async function sendIntent(
  intent: StakeIntent,
  expected: StakeExpectation,
  signer: Signer,
  chain: Chain | null,
  report: Parameters<WalletStep["run"]>[0]["report"],
): Promise<{ explorerUrl?: string; data: string }> {
  if (!intent.transaction) {
    throw new ApiError(intent.blockedBy ?? "STAKE_INTENT_EMPTY", "No transaction was built.", 409);
  }
  assertStakeIntent(intent, expected);
  report({ stage: "wallet" });
  const hash = await signer.signAndSend(intent.transaction);
  const explorerUrl = txLink(chain, hash);
  report({ stage: "submitted", data: hash, explorerUrl });
  if (intent.transaction.namespace === "eip155") await waitForSuccess(intent.transaction.chainId, hash as `0x${string}`);
  return { explorerUrl, data: hash };
}

/**
 * Add stake: on EVM, "allow the stake contract to take $X" (skipped by the
 * wallet when the allowance already covers it) then "Stake $X"; elsewhere,
 * make sure the stake account is open, then deposit.
 */
export function depositSteps(input: {
  amountAtomic: string;
  amountLabel: string;
  isEvm: boolean;
  signer: Signer | null;
  chain: Chain | null;
}): WalletStep[] {
  const { amountAtomic, amountLabel, isEvm, chain } = input;
  let built: StakeIntent | null = null;
  const intent = async () => (built ??= await createStakeDepositIntent({ amount: amountAtomic }));

  const allow: WalletStep = {
    id: "approve",
    label: `Step 1: approve. Let the stake contract move ${amountLabel} from your wallet`,
    cost: "gas",
    skip: !isEvm,
    run: async ({ report, previousAttempt }) => {
      const signer = need(input.signer);
      if (previousAttempt?.data) {
        await waitForSuccess(signer.chainId, previousAttempt.data as `0x${string}`);
        return;
      }
      report({ stage: "preparing" });
      const deposit = await intent();
      const tx = deposit.transaction;
      // No transaction: the deposit step says why (`blockedBy`); nothing to approve.
      if (!tx || tx.namespace !== "eip155" || tx.kind !== "transaction") return;
      // The deposit must be exactly depositStake(amount) on the pinned stake
      // contract, or the approval below would name an unchecked spender.
      assertStakeIntent(deposit, { kind: "DEPOSIT", amount: amountAtomic });
      // As main's `approveStakeDeposit`: an EVM deposit with no amount or a
      // non-ERC-20 asset is refused by name, not skipped into a revert later.
      if (!deposit.amount) throw new Error("This deposit intent carries no amount. Nothing was sent.");
      const token = deposit.amount.asset.split("/erc20:")[1];
      if (!token) {
        throw new Error(`The stake asset ${deposit.amount.asset} is not an ERC-20 on this chain. Nothing was sent.`);
      }
      // The approval is the one call the API names nothing of: only the pinned
      // settlement token, approving the pinned stake contract (`tx.to`, checked above).
      if (token.toLowerCase() !== pinnedDeployment(tx.chainId).settlementToken.toLowerCase()) {
        throw new Error(`The stake asset ${token} is not this chain's settlement token. Nothing was sent.`);
      }
      const amount = BigInt(deposit.amount.amount);
      const { allowanceAtomic } = await readDepositReadiness({
        chainId: tx.chainId,
        owner: signer.address,
        token,
        spender: tx.to,
      });
      if (allowanceAtomic >= amount) return;
      const approve = await fillTransaction({
        chainId: tx.chainId,
        from: signer.address,
        to: token,
        data: encodeApprove(tx.to, amount),
      });
      report({ stage: "wallet" });
      let hash: string;
      if (signer.kind === "external") {
        hash = await signer.signAndSend(approve);
      } else {
        const signed = await signer.signTransaction(approve);
        if (signed.namespace !== "eip155") throw new Error("Expected an EVM signature.");
        hash = await broadcast(tx.chainId, signed.rawTransaction);
      }
      report({ stage: "submitted", data: hash, explorerUrl: txLink(chain, hash) });
      await waitForSuccess(tx.chainId, hash as `0x${string}`);
    },
  };

  const open: WalletStep = {
    id: "open",
    label: "Open your stake account",
    cost: "gas",
    skip: isEvm,
    run: async ({ report, previousAttempt }) => {
      const signer = need(input.signer);
      if (previousAttempt?.data) return;
      report({ stage: "preparing" });
      try {
        const opened = await createOpenStakeIntent();
        return await sendIntent(opened, { kind: "OPEN_STAKE", amount: null }, signer, chain, report);
      } catch (error) {
        // Already open is the goal reached, not a failure.
        if (error instanceof ApiError && error.code === "PROVIDER_STAKE_ACCOUNT_ALREADY_OPEN") return;
        throw error;
      }
    },
  };

  const stake: WalletStep = {
    id: "deposit",
    label: isEvm ? `Step 2: deposit ${amountLabel} into your stake` : `Stake ${amountLabel}`,
    cost: "gas",
    run: async ({ report, previousAttempt }) => {
      const signer = need(input.signer);
      if (previousAttempt?.data) {
        if (isEvm) await waitForSuccess(signer.chainId, previousAttempt.data as `0x${string}`);
        return;
      }
      report({ stage: "preparing" });
      return sendIntent(await intent(), { kind: "DEPOSIT", amount: amountAtomic }, signer, chain, report);
    },
  };

  return [open, allow, stake];
}

/** Start unbonding `amountAtomic` of the stake. */
export function unstakeStep(input: { amountAtomic: string; amountLabel: string; signer: Signer | null; chain: Chain | null }): WalletStep {
  return {
    id: "unstake",
    label: `Start withdrawing ${input.amountLabel}`,
    cost: "gas",
    run: async ({ report, previousAttempt }) => {
      const signer = need(input.signer);
      if (previousAttempt?.data) {
        if (signer.chainId.startsWith("eip155:")) await waitForSuccess(signer.chainId, previousAttempt.data as `0x${string}`);
        return;
      }
      report({ stage: "preparing" });
      return sendIntent(
        await createUnstakeIntent({ amount: input.amountAtomic }),
        { kind: "UNSTAKE", amount: input.amountAtomic },
        signer,
        input.chain,
        report,
      );
    },
  };
}

/** Move unbonded stake back to the wallet. */
export function withdrawStep(input: { amountAtomic: string; amountLabel: string; signer: Signer | null; chain: Chain | null }): WalletStep {
  return {
    id: "withdraw",
    label: `Withdraw ${input.amountLabel} to your wallet`,
    cost: "gas",
    run: async ({ report, previousAttempt }) => {
      const signer = need(input.signer);
      if (previousAttempt?.data) {
        if (signer.chainId.startsWith("eip155:")) await waitForSuccess(signer.chainId, previousAttempt.data as `0x${string}`);
        return;
      }
      report({ stage: "preparing" });
      return sendIntent(
        await createStakeWithdrawIntent({ amount: input.amountAtomic }),
        { kind: "WITHDRAW", amount: input.amountAtomic },
        signer,
        input.chain,
        report,
      );
    },
  };
}
