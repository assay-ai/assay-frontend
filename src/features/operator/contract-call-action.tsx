"use client";

import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import { SignOrExport } from "@/components/patterns/sign-or-export";
import { Button } from "@/components/ui/button";
import type { WalletStep, WalletStepResult } from "@/components/patterns/sign-action";
import {
  connectedSpelling,
  sendSlashContractCall,
  signerMatches,
  signerRoleLabel,
} from "@/features/chain-calls/send-contract-call";
import { useConnectedAddresses, useSigner } from "@/hooks/useSigner";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { assertContractCall, formatCallArg, type ExpectedCall } from "@/libs/chains/evm/signing-guard";
import { explorerTxLink, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";

import { callSummary } from "./call-summary";

/**
 * One unsigned contract call the console built for the arbiter's key (a
 * ruling, an on-chain block, a cancel), as `SignOrExport`: one "Sign and
 * send" when the wallet connected here IS the signer, otherwise a file to
 * sign in the arbiter's multi-signer wallet. What it does (action, target,
 * contract, chain, signer), decoded from the calldata, is shown next to the
 * button; only the raw calldata sits under Technical details.
 *
 * Signing goes through the same `useSigner` → `sendSlashContractCall` path as
 * every other transaction in the app, which refuses a call from another
 * account, a call with value, and a call for another chain before the wallet
 * is asked anything.
 *
 * The server's `functionName` and `requestIds` are labels, and `data` is what
 * is signed (operator review 2026-10-15, F1). So the calldata is decoded here
 * against the pinned contract and must be exactly `expected` — what the
 * operator chose on this screen. When it is not, neither the wallet nor the
 * file is offered, and the details show the decoded call, never the labels.
 */
/** The pinned contracts, by the name the details show. */
const CONTRACT_LABEL: Record<ExpectedCall["contract"], string> = {
  escrow: "Escrow contract",
  stake: "Stake contract",
  config: "Config contract",
  token: "settlement token",
};

/** What a built call does, in words, for the message to its signer. */
const CALL_WHAT: Readonly<Record<string, string>> = {
  setBlocked: "the on-chain block of a wallet",
  cancelSlash: "the cancel of a penalty",
  cancelSlashBatch: "the cancel of disputed penalties",
  upholdSlashBatch: "the ruling upholding disputed penalties",
  setPaused: "a pause or resume of the contracts",
  updateConfig: "a change to the fee and stake settings",
  registerVerifier: "a new verifier key",
  revokeVerifier: "the revocation of a verifier key",
  setArbiter: "a new arbiter",
  setSlashDelay: "a new penalty dispute window",
};

/** Where a downloaded file is signed, by who signs it. */
const SIGNER_WALLET: Partial<Record<SlashContractCall["signerRole"], string>> = {
  ARBITER: "the arbiter's multi-signer wallet",
  ADMIN: "the wallet that holds the admin key",
};

export function ContractCallAction({
  call,
  expected,
  signLabel,
  afterExport,
  successTitle,
  successDescription,
  onSigned,
  onBusyChange,
  handoff,
  trackIds,
  onRetry,
  actionsContainer,
  exportVariant,
  disabled,
  disabledReason,
}: {
  call: SlashContractCall;
  /** The call the operator chose here; anything else is refused. */
  expected: ExpectedCall;
  signLabel: string;
  /** What to do with the file, and what happens once it lands. */
  afterExport: React.ReactNode;
  successTitle?: React.ReactNode;
  successDescription?: React.ReactNode;
  onSigned?: (hash: string | null) => void;
  /** True while the wallet is signing, so the sheet around it can refuse to close. */
  onBusyChange?: (busy: boolean) => void;
  /** The link and message for the signer. Default: this page, and what is to be signed. */
  handoff?: { link: string; message: string };
  /** The records it acts on, so a download or a send is remembered for them (see `SignOrExport`). */
  trackIds?: readonly string[];
  /** Build the call again, offered when this one was refused. */
  onRetry?: () => void;
  /** A sheet's sticky footer, to hold the buttons (see `SignOrExport`). */
  actionsContainer?: HTMLElement | null;
  /** "danger" for a call that stops or removes something. */
  exportVariant?: "primary" | "danger";
  /** Hold both paths back (e.g. a confirmation is not ticked yet), with the reason. */
  disabled?: boolean;
  disabledReason?: React.ReactNode;
}) {
  const connected = useConnectedAddresses();
  const signerState = useSigner({ chainId: call.chainId, address: connectedSpelling(connected, call.signer) });
  const walletAddress = signerState.status === "ready" ? signerState.signer.address : null;
  const checked = React.useMemo(() => {
    try {
      return { decoded: assertContractCall(call, expected), refusal: null };
    } catch (e) {
      return { decoded: null, refusal: e instanceof Error ? e.message : String(e) };
    }
  }, [call, expected]);
  const decoded = checked.decoded;
  const canSign = decoded !== null && signerMatches(walletAddress, call);
  const deployment = stakeDeploymentFor(call.chainId);

  const steps: WalletStep[] = React.useMemo(
    () => [
      {
        id: "send",
        label: signLabel,
        cost: "gas",
        run: async ({ report }) => {
          if (signerState.status !== "ready") throw new Error(`Connect ${call.signerRole === "ADMIN" ? "the admin's" : "the arbiter's"} wallet to sign here.`);
          report({ stage: "wallet" });
          const hash = await sendSlashContractCall(call, signerState.signer, expected);
          report({
            stage: "submitted",
            data: hash,
            explorerUrl: deployment ? (explorerTxLink(deployment, hash) ?? undefined) : undefined,
          });
          return { data: hash, explorerUrl: deployment ? (explorerTxLink(deployment, hash) ?? undefined) : undefined };
        },
      },
    ],
    [call, deployment, expected, signLabel, signerState],
  );

  const signer = `${signerRoleLabel(call.signerRole).toLowerCase()} key ${shortId(call.signer)}`;
  const what = (decoded && CALL_WHAT[decoded.functionName]) ?? "this transaction";
  const here = typeof window === "undefined" ? "/operator" : `${window.location.pathname}${window.location.search}`;

  if (decoded === null) {
    return (
      <div role="alert" className="flex w-full flex-col gap-2 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5">
        <p className="text-body-13 text-danger-700">
          The transaction the server built is not the one you asked for, so it is not offered for signing or as a file.
          Nothing was signed and nothing changed on chain.
        </p>
        <details className="text-body-xs text-02">
          <summary className="cursor-pointer select-none text-label-13 hover:text-01">Technical details</summary>
          <p className="mt-1 break-all font-mono text-mono-xs">{checked.refusal}</p>
        </details>
        {onRetry ? (
          <Button type="button" size="sm" variant="secondary" className="self-start" onClick={onRetry}>
            Build it again
          </Button>
        ) : null}
      </div>
    );
  }

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
      functionName={decoded.functionName}
      chainId={call.chainId}
      transactions={[{ to: call.to, value: call.value, data: call.data }]}
      afterExport={afterExport}
      summary={callSummary({
        functionName: decoded.functionName,
        args: decoded.args,
        contract: decoded.contract,
        to: decoded.to,
        chainId: call.chainId,
        signer: call.signer,
        signerRole: signerRoleLabel(call.signerRole).toLowerCase(),
      })}
      summaryNote="Read from the transaction itself, and checked against what you chose here."
      trackIds={trackIds}
      signerWallet={SIGNER_WALLET[call.signerRole]}
      actionsContainer={actionsContainer}
      exportVariant={exportVariant}
      disabled={disabled}
      disabledReason={disabledReason}
      handoff={handoff ?? { link: here, message: `Please sign ${what} with the ${signerRoleLabel(call.signerRole).toLowerCase()} key. The file is attached; the record is here:` }}
      details={[
        { label: "Function (decoded from the calldata)", value: decoded.functionName },
        { label: "To", value: `${decoded.to} (${CONTRACT_LABEL[decoded.contract]})` },
        ...decoded.args.map((arg, i) => ({ label: `Argument ${i + 1} (decoded)`, value: formatCallArg(arg) })),
        { label: "Must be signed by", value: call.signer },
      ]}
    />
  );
}
