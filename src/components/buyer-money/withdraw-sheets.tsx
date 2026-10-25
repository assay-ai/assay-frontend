"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import { UtcTime } from "@/components/patterns/utc-time";
import { PresetChips } from "@/components/patterns/preset-chips";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { Button } from "@/components/ui/button";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { withdrawAllHeldReason, withdrawHeldText } from "@/features/buyer-debt/debt-copy";
import { useSettleDebt } from "@/features/buyer-debt/settle-debt-sheet";
import { useOpenHoldIntentIds } from "@/features/buyer-debt/use-open-hold-intent-ids";
import { useOwedIntentIds } from "@/features/buyer-debt/use-owed-intent-ids";
import { describeMoneyError, WITHDRAWALS_FROZEN_TEXT } from "@/features/buyer-money/money-errors";
import { runEscrowAction } from "@/features/escrow/relayed-submission";
import { withdrawGasGrantNote } from "@/features/escrow/withdraw-gas-grant-note";
import { ME_STATUS_KEY } from "@/features/me-status/use-me-status";
import { useCountdown } from "@/hooks/useCountdown";
import { usePendingTransactions } from "@/hooks/usePendingTransactions";
import type { Money } from "@/interfaces/api";
import { waitForSuccess } from "@/libs/chains/evm/deposit-transaction";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { isEvmChain } from "@/libs/chains/registry";
import { createEscrowClaimIntent, createEscrowWithdrawIntent } from "@/services/escrow.service";
import { formatMoney, parseAmountInput, toDecimal } from "@/utils/money";

import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";
import { chainTerms, UNKNOWN } from "@/libs/chain-terms";

/**
 * Getting unspent money out: Request (free) → Wait ~1 h → Claim (you pay gas).
 *
 * The two things buyers got wrong before are said inside the drawer: a new
 * request REPLACES the standing one (it does not add), and paid calls stop
 * while a request stands. The latter is a warning right above the button,
 * naming the chain, because it holds for a partial amount too: the backend
 * refuses every voucher on that chain while a request is open (the escrow's
 * `withdraw()` reads no voucher state). An explicit tick confirms it as well
 * (wave-1 audit M6).
 *
 * The sheet never promises the full amount (wave-1 audit I2): the claim pays
 * `min(requested, balance)`, the request is not checked against spendable on
 * the server, and a paid call admitted before the request lands is redeemed
 * out of the balance first.
 */

/** The pause a withdrawal request causes, in one sentence. Per chain, never account-wide. */
export function withdrawPauseWarning(chainName: string | null, withdrawDelay: string = UNKNOWN): string {
  return `While this request is open (about ${withdrawDelay}), every agent's paid calls on ${chainName ?? "this chain"} stop, even for a partial amount. Free calls keep working.`;
}

/**
 * True only when `GET /escrow` says the withdrawal path is frozen (the last
 * reconciliation was CRITICAL, lot 1 D16). Unknown (`null`) and an older
 * backend (absent) are not frozen: the server still refuses, as before.
 */
export function withdrawalsFrozen(escrow: { withdrawalsFrozen?: boolean | null } | null | undefined): boolean {
  return escrow?.withdrawalsFrozen === true;
}

/** The frozen banner, shown before anything is signed. */
function FrozenBanner() {
  return (
    <p role="status" data-testid="withdrawals-frozen" className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700">
      {WITHDRAWALS_FROZEN_TEXT}
    </p>
  );
}

/** The tick that confirms the pause and the payout, beside the warning. */
export function withdrawAcknowledgement(chainName: string | null): string {
  return `I understand paid calls on ${chainName ?? "this chain"} stop until I claim or cancel this, and I may receive less than I ask for.`;
}

/**
 * What a request pays out: up to the amount, never more. `withdraw()` pays
 * `min(requested, balance)`, and paid calls that land before the request is on
 * chain are paid out of the balance first.
 */
export function withdrawReceiveNote(requested: Money | null): string {
  const upTo = requested ? formatLimit(requested) : "the amount you ask for";
  return `You receive up to ${upTo}. It can be less if paid calls land before the request is on chain; never more.`;
}

/**
 * The held money and what a request for `requested` pays out while calls hold
 * money. Null when no amount is chosen yet or nothing is held.
 *
 * With unpaid calls, the held amount and its Settle button are already said
 * above (`withdrawHeldText`), so it is not named again.
 */
export function withdrawHeldNote(requested: Money | null, held: Money | null, owedCalls: number): string | null {
  if (!requested || !held || BigInt(held.amount) <= 0n) return null;
  const receive = withdrawReceiveNote(requested);
  if (owedCalls > 0) return `That money is not part of this request. ${receive}`;
  return `${formatLimit(held)} is held by calls being checked and is not part of this request. ${receive}`;
}

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
  const delay = chainTerms(money.chain).withdrawDelay;
  const [amount, setAmount] = React.useState("");
  // "Use all" is preselected once per opening (B7); the buyer can still change it.
  const [seeded, setSeeded] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setAmount("");
      setSeeded(false);
    }
  }, [open]);

  const escrow = money.escrow;
  const balance = escrow?.balance ?? null;
  const standing = positive(escrow?.withdrawRequested?.amount) ? escrow!.withdrawRequested : null;
  // What can be withdrawn NOW: the balance minus what calls being checked hold
  // — the same figure as the Funding hero. Held money is not withdrawable yet.
  const available = escrow?.spendable ?? null;
  const held = escrow?.openHolds && positive(escrow.openHolds.amount) ? escrow.openHolds : null;
  const all = available && toDecimal(available).gt(0) ? toDecimal(available).toString() : null;
  if (open && mode !== "cancel" && !seeded && all !== null) {
    setSeeded(true);
    setAmount(all);
  }
  const raw = parseAmountInput(amount, { decimals: money.decimals });
  const overMax = Boolean(raw.value && available && raw.value.gt(toDecimal(available)));
  const parsed = overMax
    ? { ...raw, value: null, atomic: null, error: `You can withdraw at most ${formatLimit(available)} now.` }
    : raw;
  const cancelling = mode === "cancel";
  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);
  // A buyer debt's price stays held until it is collected, not "a few minutes": say so, and offer to settle.
  const openHoldIds = useOpenHoldIntentIds();
  const owedIntentIds = useOwedIntentIds();
  const { openSettle } = useSettleDebt();
  const heldText = held ? withdrawHeldText(formatLimit(held), openHoldIds, owedIntentIds) : null;
  const requestedMoney: Money | null = parsed.atomic && held ? { ...held, amount: parsed.atomic } : null;
  const heldNote = cancelling ? null : withdrawHeldNote(requestedMoney, held, heldText?.owed ?? 0);
  const settleFirst = () => {
    onOpenChange(false);
    openSettle();
  };
  const settleButton = (
    <Button size="sm" variant="secondary" type="button" className="self-start" onClick={settleFirst}>
      Settle what is owed
    </Button>
  );

  const frozen = withdrawalsFrozen(escrow);
  const disabledReason = readOnly
    ? "Your account is blocked, so withdrawals are paused."
    : frozen
      ? "Withdrawals are paused for now."
    : !escrow?.exists
      ? "You have no escrow yet, so there is nothing to withdraw."
      : cancelling
        ? walletBlocker
        : !balance || toDecimal(balance).lte(0)
          ? "Your escrow is empty."
          : !all
            ? withdrawAllHeldReason(openHoldIds, owedIntentIds)
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
      promptTitle: cancelling
        ? "Cancel your withdrawal request"
        : parsed.value
          ? `Request a withdrawal of ${formatMoney({ amount: parsed.atomic!, asset: "", decimals: money.decimals })}`
          : undefined,
      promptDescription: cancelling
        ? "Your whole balance stays in your escrow. Free, no gas."
        : `Nothing moves yet: you claim it to your wallet after about ${delay}. Free, no gas.`,
      run: async ({ report, prompt }) => {
        const signer = requireSigner(money.signerState, money.ownerShort, prompt);
        report({ stage: "preparing" });
        const requestedAmount = cancelling ? "0" : parsed.atomic!;
        const intent = await createEscrowWithdrawIntent({ amount: requestedAmount });
        report({ stage: "wallet" });
        // Signed only if the payload is this request for this amount.
        const result = await runEscrowAction(intent, signer, { kind: "REQUEST_WITHDRAW", amount: requestedAmount });
        const hash = result.kind === "relayed" ? result.relayed.transactionHash : result.signature;
        if (result.kind === "relayed") queryClient.setQueryData(["escrow", null], result.relayed.escrow);
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        // The debts ride on `GET /me/status` now; they refreshed with the escrow before.
        void queryClient.invalidateQueries({ queryKey: ME_STATUS_KEY });
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, hash) : undefined };
      },
    },
  ];

  const availableAt = money.escrow?.withdrawAvailableAt;
  const chainName = money.chainName;

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      chain={money.chain}
      title={cancelling ? "Cancel your withdrawal request?" : "Withdraw"}
      description={
        cancelling
          ? "Nothing leaves your escrow. Your agents can pay for calls again straight away."
          : `Takes about ${delay}: ask now (free), then claim it to your wallet.`
      }
      steps={steps}
      label={label}
      resetKey={amount}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      describeError={describeMoneyError}
      acknowledge={cancelling ? undefined : withdrawAcknowledgement(chainName)}
      successTitle={cancelling ? "Request cancelled" : "Withdrawal requested"}
      successDescription={
        cancelling ? (
          "Your agents can pay again."
        ) : availableAt ? (
          <>
            Next: claim it on the Funding page from <UtcTime value={availableAt} />. Paid calls on {chainName ?? "this chain"} are
            paused until then; free calls keep working.
          </>
        ) : (
          `Next: claim it on the Funding page in about ${delay}. Paid calls on ${chainName ?? "this chain"} are paused until then; free calls keep working.`
        )
      }
      doneAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      {frozen ? <FrozenBanner /> : null}
      {cancelling ? null : (
        <>
          <StatusTimeline
            label="Withdrawal steps"
            orientation="auto"
            steps={[
              { id: "request", label: "Request (free)", state: "current" },
              { id: "wait", label: `Wait ~${delay}`, state: "upcoming" },
              { id: "claim", label: "Claim (you pay gas)", state: "upcoming" },
            ]}
          />
          <div className="flex flex-col gap-2">
            <span className="text-label-sm text-01">Amount</span>
            <PresetChips
              label="Withdrawal amount"
              presets={all ? [{ value: all, label: "Use all", description: formatLimit(available) }] : []}
              value={amount}
              onChange={setAmount}
              error={amount.trim() !== "" ? parsed.error : null}
              hint={available ? `Available to withdraw now: ${formatLimit(available)}` : undefined}
            />
          </div>
          {/* Once an amount is chosen, the note below names the held amount; an unpaid call keeps this line and its settle button. */}
          {heldText && (!heldNote || heldText.owed > 0) ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-13 text-02" data-testid="withdraw-held-note">
                {heldText.text}
              </p>
              {heldText.owed > 0 ? settleButton : null}
            </div>
          ) : null}
          {standing ? (
            <p className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700">
              You already asked for {formatLimit(standing)}. A new request replaces it (it does not add to it) and starts the
              {" "}{chainTerms(money.chain).withdrawDelay} wait again.
            </p>
          ) : null}
          {heldNote ? (
            <p className="text-body-13 text-02" data-testid="withdraw-held-receive">
              {heldNote}
            </p>
          ) : (
            <p className="text-body-xs text-03" data-testid="withdraw-receive">
              {withdrawReceiveNote(parsed.atomic ? { asset: "", decimals: money.decimals, amount: parsed.atomic } : null)}
            </p>
          )}
          {/* Last, so it sits right above the button: the consequence of pressing it. */}
          <p
            role="note"
            data-testid="withdraw-pause-warning"
            className="rounded-lg border border-warning-20 bg-warning-10 px-3 py-2.5 text-body-13 text-warning-700"
          >
            {withdrawPauseWarning(chainName, delay)}
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
  const frozen = withdrawalsFrozen(escrow);
  const notYet = frozen
    ? "Withdrawals are paused for now."
    : !requested || BigInt(requested.amount || "0") === 0n
    ? "There is no withdrawal to claim. Request one first."
    : !matured
      ? `Not ready yet: the ${chainTerms(money.chain).withdrawDelay} after your request have not passed.`
      : null;

  const steps: WalletStep[] = [
    {
      id: "claim",
      label,
      cost: evm ? "gas" : "free",
      promptDescription: payout
        ? `Moves ${formatLimit(payout)} from your escrow to your wallet.${evm ? " You pay the network fee." : ""}`
        : undefined,
      run: async ({ report, previousAttempt, prompt }) => {
        const signer = requireSigner(money.signerState, money.ownerShort, prompt);
        let hash = previousAttempt?.data as string | undefined;
        if (!hash) {
          report({ stage: "preparing" });
          const intent = await createEscrowClaimIntent();
          const note = withdrawGasGrantNote(intent.gasGrant);
          setGrantText(note?.text ?? null);
          report({ stage: "wallet" });
          // Signed only if it is the claim (`withdraw()`) on the pinned escrow.
          const result = await runEscrowAction(intent, signer, { kind: "WITHDRAW" });
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
        // The debts ride on `GET /me/status` now; they refreshed with the escrow before.
        void queryClient.invalidateQueries({ queryKey: ME_STATUS_KEY });
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, hash) : undefined };
      },
    },
  ];

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      chain={money.chain}
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
      {frozen ? <FrozenBanner /> : null}
      {evm ? (
        <p className="text-body-13 text-02">
          This is a transaction you send yourself, so it costs a small network fee in ETH from your wallet.
        </p>
      ) : null}
      {grantText ? <p className="text-body-xs text-03">{grantText}</p> : null}
    </WalletActionSheet>
  );
}
