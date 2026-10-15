"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { capsToForm, keyGroups, parseCaps } from "@/features/buyer-money/caps";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import { DEFAULT_DELEGATION_DAYS, parseDelegationForm, serverNowSeconds } from "@/features/delegation/delegation-form";
import { submitRelayedDelegation } from "@/features/delegation/relayed-delegation";
import { applyLimitsSubmitted } from "@/features/escrow/after-set-limits";
import { runEscrowAction } from "@/features/escrow/relayed-submission";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { createDelegateIntent, submitDelegate } from "@/services/delegation.service";
import { createEscrowLimitsIntent } from "@/services/escrow.service";
import { cn } from "@/utils";
import { addressOfAccount } from "@/utils/chain";

import { CapsFields, type CapsValue } from "./caps-fields";
import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";

/**
 * "Let your agent pay": the escrow's safety caps and the agent's own pay
 * permission in one drawer and (at most) two free signatures. One set of
 * numbers applies to both, so nobody has to understand two limit systems to
 * get a first paid call through. The caps step is skipped when the escrow
 * already allows at least as much.
 *
 * The key check is by eye: the key is shown in 4-character groups next to
 * what `agent-cli` printed, and a tick confirms they match. It keeps the
 * point of the old "type the last 4 characters" (you only authorise a key you
 * actually ran) without switching to a terminal to copy them.
 */
export interface LetAgentPaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  /** CAIP-10 of the agent's payment key (bound with `agent-cli bind`). */
  delegateAccount: string | null;
}

export function KeyMatch({ account }: { account: string }) {
  const groups = keyGroups(account);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label-13 text-01">The agent&apos;s payment key</span>
      <div
        className="flex flex-wrap gap-1.5 rounded-lg border border-01 bg-02 p-3"
        aria-label={`Key ${groups.join(" ")}`}
        data-testid="key-groups"
      >
        {groups.map((group, i) => (
          <span
            key={i}
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-mono-sm font-semibold",
              i % 2 === 0 ? "bg-primary-10 text-primary-700" : "bg-teal-10 text-teal-600",
            )}
          >
            {group}
          </span>
        ))}
      </div>
      <span className="text-body-xs text-03">
        Compare it with what <span className="font-mono">agent-cli address</span> prints on the agent&apos;s machine.
      </span>
    </div>
  );
}

export function LetAgentPaySheet({ open, onOpenChange, agentName, delegateAccount }: LetAgentPaySheetProps) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const money = useBuyerMoney();
  const escrow = money.escrow;
  const [value, setValue] = React.useState<CapsValue>({ perCall: "", perDay: "" });
  const [seeded, setSeeded] = React.useState(false);
  // The escrow caps as they were when the drawer opened. Frozen so the step
  // list cannot change under a running flow (a retry resumes by index).
  const [openingCaps, setOpeningCaps] = React.useState<{ perCall: string; perWindow: string } | null>(null);
  if (open && !seeded) {
    setSeeded(true);
    setValue(capsToForm(escrow) ?? { perCall: "1", perDay: "20" });
    setOpeningCaps(
      escrow?.maxVoucherAmount && escrow.maxPerWindow
        ? { perCall: escrow.maxVoucherAmount.amount, perWindow: escrow.maxPerWindow.amount }
        : null,
    );
  }
  if (!open && seeded) setSeeded(false);

  const parsed = parseCaps(value.perCall, value.perDay, money.decimals);
  const chosen =
    parsed.ok && parsed.perCall.atomic && parsed.perDay.atomic
      ? { maxVoucherAmount: parsed.perCall.atomic, maxPerWindow: parsed.perDay.atomic }
      : null;
  // The escrow caps cover the choice already: no first signature needed.
  const capsCover = Boolean(
    chosen &&
      openingCaps &&
      BigInt(openingCaps.perCall) >= BigInt(chosen.maxVoucherAmount) &&
      BigInt(openingCaps.perWindow) >= BigInt(chosen.maxPerWindow),
  );
  const nowSeconds = serverNowSeconds(escrow?.serverTime, money.escrowQuery.dataUpdatedAt, Date.now());
  const until = new Date((nowSeconds + DEFAULT_DELEGATION_DAYS * 86_400) * 1000).toISOString();

  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);
  const disabledReason = readOnly
    ? "Your account is blocked, so payments cannot be authorised now."
    : !delegateAccount
      ? "The agent has no payment key yet. Run agent-cli bind on its machine first."
      : !escrow?.exists
        ? "Add funds first: your first deposit opens your escrow."
        : !chosen
          ? (parsed.perCall.error ?? parsed.perDay.error ?? "Choose caps.")
          : walletBlocker;

  const domain = () => {
    const contract = escrow?.escrowPda ? addressOfAccount(escrow.escrowPda) : "";
    if (!money.chainId || !contract) {
      throw new Error("The escrow could not be read, so there is nothing to check a signature request against.");
    }
    return { chainId: money.chainId.split(":")[1]!, verifyingContract: contract };
  };

  const steps: WalletStep[] = [
    {
      id: "caps",
      label: "Set your escrow's safety caps",
      cost: "free",
      skip: capsCover,
      run: async ({ report }) => {
        const signer = requireSigner(money.signerState, money.ownerShort);
        report({ stage: "preparing" });
        const intent = await createEscrowLimitsIntent(chosen!);
        report({ stage: "wallet" });
        const result = await runEscrowAction(intent, signer);
        await applyLimitsSubmitted(queryClient, null, chosen!, result.kind === "relayed" ? result.relayed.escrow : null);
        const hash = result.kind === "relayed" ? result.relayed.transactionHash : result.signature;
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, hash) : undefined };
      },
    },
    {
      id: "grant",
      label: `Let ${agentName} pay`,
      cost: "free",
      run: async ({ report }) => {
        const signer = requireSigner(money.signerState, money.ownerShort);
        report({ stage: "preparing" });
        const caps = {
          maxVoucherAmount: { amount: chosen!.maxVoucherAmount, asset: "", decimals: money.decimals },
          maxPerWindow: { amount: chosen!.maxPerWindow, asset: "", decimals: money.decimals },
        };
        const form = parseDelegationForm(
          { maxVoucherAmount: value.perCall, maxPerWindow: value.perDay, validDays: String(DEFAULT_DELEGATION_DAYS) },
          caps,
          addressOfAccount(delegateAccount!),
          nowSeconds,
        );
        if (!form.ok) throw new Error(Object.values(form.errors)[0] ?? "These caps cannot be used.");
        const intent = await createDelegateIntent(form.body);
        report({ stage: "wallet" });
        const relayed = await submitRelayedDelegation(
          intent,
          signer,
          { ...form.body, delegate: delegateAccount!, domain: domain() },
          submitDelegate,
        );
        void queryClient.invalidateQueries({ queryKey: ["escrow-delegates"] });
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, relayed.transactionHash) : undefined };
      },
    },
  ];

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Let ${agentName} pay`}
      description="Your agent pays for calls from your escrow, within these caps. It cannot withdraw, change your caps or authorise anyone else. Free, no gas."
      steps={steps}
      label={capsCover ? "Sign to allow (free)" : "Sign to apply (free)"}
      resetKey={`${value.perCall}|${value.perDay}|${delegateAccount ?? ""}`}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      describeError={describeMoneyError}
      acknowledge={delegateAccount ? "These characters match the key agent-cli printed." : undefined}
      successTitle={`${agentName} can pay now`}
      successDescription={
        <>
          Within these caps until <LocalTime value={until} dateOnly />. Next: its next paid call goes through; you can
          watch it under Activity.
        </>
      }
      doneAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      {delegateAccount ? <KeyMatch account={delegateAccount} /> : null}
      <CapsFields value={value} onChange={setValue} parsed={parsed} idPrefix="agent-pay" label="Caps for this agent" />
      <p className="text-body-xs text-03">
        Valid for {DEFAULT_DELEGATION_DAYS} days, until <LocalTime value={until} dateOnly />.{" "}
        {capsCover ? "One signature." : "Two signatures: your escrow's safety caps, then the agent's permission."}
      </p>
    </WalletActionSheet>
  );
}
