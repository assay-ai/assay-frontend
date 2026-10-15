"use client";

import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import { SignOrExport } from "@/components/patterns/sign-or-export";
import type { WalletStep, WalletStepResult } from "@/components/patterns/sign-action";
import {
  connectedSpelling,
  sendSlashContractCall,
  signerMatches,
  signerRoleLabel,
} from "@/features/chain-calls/send-contract-call";
import { useConnectedAddresses, useSigner } from "@/hooks/useSigner";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { explorerTxLink, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";

/**
 * One unsigned contract call the console built for the arbiter's key (a
 * ruling, an on-chain block, a cancel), as `SignOrExport`: one "Sign and
 * send" when the wallet connected here IS the signer, otherwise "Download
 * Safe batch". The calldata and signer sit under Technical details.
 *
 * Signing goes through the same `useSigner` → `sendSlashContractCall` path as
 * every other transaction in the app, which refuses a call from another
 * account, a call with value, and a call for another chain before the wallet
 * is asked anything.
 */
export function ContractCallAction({
  call,
  signLabel,
  afterExport,
  successTitle,
  successDescription,
  onSigned,
  onBusyChange,
}: {
  call: SlashContractCall;
  signLabel: string;
  /** What to do with the file, and what happens once it lands. */
  afterExport: React.ReactNode;
  successTitle?: React.ReactNode;
  successDescription?: React.ReactNode;
  onSigned?: (hash: string | null) => void;
  /** True while the wallet is signing, so the sheet around it can refuse to close. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const connected = useConnectedAddresses();
  const signerState = useSigner({ chainId: call.chainId, address: connectedSpelling(connected, call.signer) });
  const walletAddress = signerState.status === "ready" ? signerState.signer.address : null;
  const canSign = signerMatches(walletAddress, call);
  const deployment = stakeDeploymentFor(call.chainId);

  const steps: WalletStep[] = React.useMemo(
    () => [
      {
        id: "send",
        label: signLabel,
        cost: "gas",
        run: async ({ report }) => {
          if (signerState.status !== "ready") throw new Error("Connect the arbiter's wallet to sign here.");
          report({ stage: "wallet" });
          const hash = await sendSlashContractCall(call, signerState.signer);
          report({
            stage: "submitted",
            data: hash,
            explorerUrl: deployment ? (explorerTxLink(deployment, hash) ?? undefined) : undefined,
          });
          return { data: hash, explorerUrl: deployment ? (explorerTxLink(deployment, hash) ?? undefined) : undefined };
        },
      },
    ],
    [call, deployment, signLabel, signerState],
  );

  const signer = `${signerRoleLabel(call.signerRole).toLowerCase()} (${shortId(call.signer)})`;

  return (
    <SignOrExport
      canSign={canSign}
      signerLabel={signer}
      signLabel={signLabel}
      steps={steps}
      successTitle={successTitle}
      successDescription={successDescription}
      onSigned={(results: (WalletStepResult | undefined)[]) => {
        const last = results[results.length - 1];
        onSigned?.(typeof last?.data === "string" ? last.data : null);
      }}
      describeError={(error) => (error instanceof Error ? error.message.split("\n")[0]! : "The wallet did not complete this.")}
      onPhaseChange={(phase) => onBusyChange?.(phase === "running")}
      functionName={call.functionName}
      chainId={call.chainId}
      transactions={[{ to: call.to, value: call.value, data: call.data }]}
      afterExport={afterExport}
      details={[
        { label: "Must be signed by", value: call.signer },
        ...(call.requestIds.length > 0 ? [{ label: "Penalty request ids", value: call.requestIds.join(", ") }] : []),
      ]}
    />
  );
}
