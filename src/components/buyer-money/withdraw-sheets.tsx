"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import { LocalTime } from "@/components/patterns/local-time";
import { PresetChips } from "@/components/patterns/preset-chips";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import { runEscrowAction } from "@/features/escrow/relayed-submission";
import { withdrawGasGrantNote } from "@/features/escrow/withdraw-gas-grant-note";
import { useCountdown } from "@/hooks/useCountdown";
import { usePendingTransactions } from "@/hooks/usePendingTransactions";
import { waitForSuccess } from "@/libs/chains/evm/deposit-transaction";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { isEvmChain } from "@/libs/chains/registry";
import { createEscrowClaimIntent, createEscrowWithdrawIntent } from "@/services/escrow.service";
import { formatMoney, parseAmountInput, toDecimal } from "@/utils/money";

import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";

/**
 * Getting unspent money out: Request (free) → Wait ~1 h → Claim (you pay gas).
 *
 * The two things buyers got wrong before are said inside the drawer: a new
 * request REPLACES the standing one (it does not add), and agents stop paying
 * while a request stands — the latter as a checkbox, not a paragraph.
 */
function positive(amount: string | undefined): boolean {
  return Boolean(amount && BigInt(amount) > 0n);
}

export function WithdrawSheet({
  open,
  onOpenChange,
  mode = "request",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "cancel" clears a standing request (a request for 0). */
  mode?: "request" | "cancel";
}) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const money = useBuyerMoney();
  const [amount, setAmount] = React.useState("");
  React.useEffect(() => {
    if (!open) setAmount("");
  }, [open]);

  const escrow = money.escrow;
  const balance = escrow?.balance ?? null;
  const standing = positive(escrow?.withdrawRequested?.amount) ? escrow!.withdrawRequested : null;
  const all = balance ? toDecimal(balance).toString() : null;
  const parsed = parseAmountInput(amount, { decimals: money.decimals, max: all ?? undefined });
  const cancelling = mode === "cancel";
  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);

  const disabledReason = readOnly
    ? "Your account is blocked, so withdrawals are paused."
    : !escrow?.exists
      ? "You have no escrow yet, so there is nothing to withdraw."
      : cancelling
        ? walletBlocker
        : !balance || toDecimal(balance).lte(0)
          ? "Your escrow is empty."
          : !parsed.value
            ? amount.trim() === ""
              ? "Pick or enter an amount."
              : (parsed.error ?? "Enter an amount.")
            : walletBlocker;

  const label = cancelling
    ? "Cancel the request (free)"
    : parsed.value
      ? `Request ${formatMoney({ amount: parsed.atomic!, asset: "", decimals: money.decimals })} (free)`
      : "Request withdrawal (free)";

  const steps: WalletStep[] = [
    {
      id: "request",
      label: cancelling ? "Cancel the withdrawal request" : "Request the withdrawal",
      cost: "free",
      run: async ({ report }) => {
        const signer = requireSigner(money.signerState, money.ownerShort);
        report({ stage: "preparing" });
        const intent = await createEscrowWithdrawIntent({ amount: cancelling ? "0" : parsed.atomic! });
        report({ stage: "wallet" });
        const result = await runEscrowAction(intent, signer);
        const hash = result.kind === "relayed" ? result.relayed.transactionHash : result.signature;
        if (result.kind === "relayed") queryClient.setQueryData(["escrow", null], result.relayed.escrow);
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, hash) : undefined };
      },
    },
  ];

  const availableAt = money.escrow?.withdrawAvailableAt;

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={cancelling ? "Cancel your withdrawal request?" : "Withdraw"}
      description={
        cancelling
          ? "Nothing leaves your escrow. Your agents can pay for calls again straight away."
          : "Takes about an hour: ask now (free), then claim it to your wallet."
      }
      steps={steps}
      label={label}
      resetKey={amount}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      describeError={describeMoneyError}
      acknowledge={cancelling ? undefined : "My agents stop paying for calls until I claim this or cancel it."}
      successTitle={cancelling ? "Request cancelled" : "Withdrawal requested"}
      successDescription={
        cancelling ? (
          "Your agents can pay again."
        ) : availableAt ? (
          <>
            Next: claim it on the Funding page from <LocalTime value={availableAt} />. Your agents are paused until then.
          </>
        ) : (
          "Next: claim it on the Funding page in about an hour. Your agents are paused until then."
        )
      }
      doneAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      {cancelling ? null : (
        <>
          <StatusTimeline
            label="Withdrawal steps"
            orientation="auto"
            steps={[
              { id: "request", label: "Request (free)", state: "current" },
              { id: "wait", label: "Wait ~1 hour", state: "upcoming" },
              { id: "claim", label: "Claim (you pay gas)", state: "upcoming" },
            ]}
          />
          <div className="flex flex-col gap-2">
            <span className="text-label-sm text-01">Amount</span>
            <PresetChips
              label="Withdrawal amount"
              presets={all ? [{ value: all, label: "Use all", description: formatLimit(balance) }] : []}
              value={amount}
              onChange={setAmount}
              error={amount.trim() !== "" ? parsed.error : null}
              hint={balance ? `In your escrow: ${formatLimit(balance)}` : undefined}
            />
          </div>
          {standing ? (
            <p className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700">
              You already asked for {formatLimit(standing)}. A new request replaces it (it does not add to it) and starts the
              hour again.
            </p>
          ) : null}
          <p className="text-body-xs text-03">
            Calls already made still settle first, so you receive at most the amount you ask for.
          </p>
        </>
      )}
    </WalletActionSheet>
  );
}

export function ClaimSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const money = useBuyerMoney();
  const pending = usePendingTransactions();
  const escrow = money.escrow;
  const requested = escrow?.withdrawRequested ?? null;
  const payout =
    requested && escrow?.balance && toDecimal(escrow.balance).lt(toDecimal(requested)) ? escrow.balance : requested;
  const [grantText, setGrantText] = React.useState<string | null>(null);
  const evm = money.chainId !== null && isEvmChain(money.chainId);
  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);
  const label = payout ? `Claim ${formatLimit(payout)}` : "Claim";
  const { hasPassed: matured } = useCountdown(escrow?.withdrawAvailableAt);
  const notYet = !requested || BigInt(requested.amount || "0") === 0n
    ? "There is no withdrawal to claim. Request one first."
    : !matured
      ? "Not ready yet: the hour after your request has not passed."
      : null;

  const steps: WalletStep[] = [
    {
      id: "claim",
      label,
      cost: evm ? "gas" : "free",
      run: async ({ report, previousAttempt }) => {
        const signer = requireSigner(money.signerState, money.ownerShort);
        let hash = previousAttempt?.data as string | undefined;
        if (!hash) {
          report({ stage: "preparing" });
          const intent = await createEscrowClaimIntent();
          const note = withdrawGasGrantNote(intent.gasGrant);
          setGrantText(note?.text ?? null);
          report({ stage: "wallet" });
          const result = await runEscrowAction(intent, signer);
          hash = result.kind === "relayed" ? result.relayed.transactionHash : result.signature;
          const explorerUrl = money.chain ? explorerTxUrl(money.chain, hash) : undefined;
          report({ stage: "submitted", data: hash, explorerUrl });
          pending.track({
            id: `claim:${hash}`,
            kind: "claim",
            label,
            chainId: money.chainId ?? "",
            hash,
            explorerUrl,
            submittedAt: Date.now(),
          });
        }
        try {
          if (evm && money.chainId) await waitForSuccess(money.chainId, hash as `0x${string}`);
        } catch (error) {
          pending.release(`claim:${hash}`);
          throw error;
        }
        pending.resolve(`claim:${hash}`);
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, hash) : undefined };
      },
    },
  ];

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Claim your withdrawal"
      description={`${payout ? formatLimit(payout) : "The amount"} goes to your wallet${money.ownerShort ? ` ${money.ownerShort}` : ""}.`}
      steps={steps}
      label={label}
      disabled={readOnly || Boolean(notYet) || Boolean(walletBlocker)}
      disabledReason={readOnly ? "Your account is blocked, so withdrawals are paused." : (notYet ?? walletBlocker)}
      describeError={describeMoneyError}
      successTitle="Withdrawn to your wallet"
      successDescription="Your agents can pay for calls again with what is left in your escrow."
      doneAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      {evm ? (
        <p className="text-body-13 text-02">
          This is a transaction you send yourself, so it costs a small network fee in ETH from your wallet.
        </p>
      ) : null}
      {grantText ? <p className="text-body-xs text-03">{grantText}</p> : null}
    </WalletActionSheet>
  );
}
