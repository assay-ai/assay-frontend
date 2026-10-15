/**
 * Dispute one penalty on chain: the provider's stake wallet sends
 * `disputeSlashBatch([requestId])`. One signature, gas paid by the wallet.
 *
 * The backend builds the unsigned call (`POST /providers/me/slash-requests/
 * dispute-intent`); before anything is signed, the call is checked to be
 * exactly that dispute, to the pinned stake contract, from this wallet
 * (`disputeCallMismatch`). This is the ONLY dispute path — the off-chain
 * objection (`POST /providers/me/slash-proposals/:id/dispute`) is retired.
 */

import type { WalletStep } from "@/components/patterns/wallet-steps";
import { sendSlashContractCall } from "@/features/chain-calls/send-contract-call";
import { disputeErrorMessage } from "@/features/chain-slashes/dispute-selection";
import type { Signer } from "@/hooks/useSigner";
import { ApiError } from "@/libs/ApiClient";
import { waitForContractCall } from "@/libs/chains/evm/contract-call";
import { fillTransaction } from "@/libs/chains/evm/deposit-transaction";
import { disputeCallMismatch } from "@/libs/chains/evm/stake-slashes/dispute-call";
import type { StakeDeployment } from "@/libs/chains/evm/stake-slashes/deployments";
import { createSlashDisputeIntent } from "@/services/provider-slash-cases.service";

const NOT_CONNECTED = "Connect your stake wallet in this browser: it is the only account the contract accepts a dispute from.";

export class DisputeRefused extends Error {}

export function disputeStep(input: {
  requestId: string;
  deployment: StakeDeployment;
  ownAddress: string | null;
  signer: Signer | null;
  explorerUrl: (hash: string) => string | undefined;
}): WalletStep {
  return {
    id: "dispute",
    label: "Dispute this penalty on chain",
    cost: "gas",
    run: async ({ report, previousAttempt }) => {
      const { deployment, ownAddress, signer, requestId } = input;
      if (previousAttempt?.data) {
        await waitForContractCall(deployment.chainId, previousAttempt.data as `0x${string}`, "disputeSlashBatch");
        return;
      }
      if (!ownAddress || !signer) throw new DisputeRefused(NOT_CONNECTED);
      report({ stage: "preparing" });
      let call;
      try {
        call = await createSlashDisputeIntent({ chainId: deployment.chainId, requestIds: [requestId] });
      } catch (error) {
        throw new DisputeRefused(disputeErrorMessage(error, deployment.displayName), { cause: error });
      }
      const mismatch = disputeCallMismatch(call, deployment, ownAddress, [requestId]);
      if (mismatch) {
        throw new DisputeRefused(
          `Nothing was sent: the transaction Assay prepared is not this dispute (${mismatch}). Contact Assay support.`,
        );
      }
      report({ stage: "wallet" });
      // Signed only if the calldata decodes to exactly this dispute on the pinned stake contract.
      const expected = { contract: "stake", functionName: "disputeSlashBatch", args: [[requestId]] } as const;
      await sendSlashContractCall(call, signer, expected, {
        fill: fillTransaction,
        wait: (chainId, hash, functionName) => {
          report({ stage: "submitted", data: hash, explorerUrl: input.explorerUrl(hash) });
          return waitForContractCall(chainId, hash, functionName);
        },
      });
    },
  };
}

/** One sentence for a failed dispute; the raw message stays under Details. */
export function describeDisputeError(error: unknown): string {
  if (error instanceof DisputeRefused) return error.message;
  if (error instanceof ApiError) return disputeErrorMessage(error, "the chain");
  if (error instanceof Error && /would refuse/.test(error.message)) return error.message.split("\n")[0]!;
  return "The dispute did not go through. Nothing changed on chain; you can try again.";
}
