"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { PresetChips } from "@/components/patterns/preset-chips";
import { WalletActionSheet } from "@/components/patterns/sign-action";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { usePenaltySummary } from "@/features/provider-penalties/use-penalty-summary";
import { routes } from "@/libs/routes";
import { formatDecimal, formatMoney, parseAmountInput, toDecimal } from "@/utils/money";

import { stakeActionChain } from "./chain-stake";
import { describeStakeError, unstakeStep, withdrawStep } from "./stake-steps";
import { PROVIDER_STAKE_KEY, useStakeStatus } from "./use-stake-status";
import { useStakeWallet, walletBlocker } from "./use-stake-wallet";
import { availableAfterRequest, periodLabel, withdrawStateOf } from "./withdraw-state";

/**
 * "Withdraw stake": one sheet for both halves of getting stake back.
 *
 * 1. Start withdrawing an amount (Max chip). It unbonds for the waiting
 *    period, then becomes withdrawable. A new request restarts the clock for
 *    the WHOLE unbonding balance — said before the signature, not after.
 * 2. When the clock has ended, "Withdraw $X to your wallet".
 *
 * Never shows a nonce, gas figure or chain id; open penalties and paid tools
 * that would pause are named as chips with links.
 */
export function WithdrawSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const status = useStakeStatus();
  const wallet = useStakeWallet(status);
  const penalties = usePenaltySummary();
  const queryClient = useQueryClient();
  const entry = stakeActionChain(status.stake ?? undefined);
  const state = withdrawStateOf(entry);
  const decimals = state.staked?.decimals ?? status.required?.decimals ?? 6;

  const [value, setValue] = React.useState("");
  React.useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const max = state.staked ? toDecimal(state.staked).toFixed() : undefined;
  const parsed = parseAmountInput(value, { decimals, max });
  const amountLabel = parsed.value ? formatDecimal(parsed.value) : "";
  const remaining = parsed.value && state.staked ? toDecimal(state.staked).minus(parsed.value) : null;
  const pausesTools =
    remaining !== null && status.required ? remaining.lt(toDecimal(status.required)) : false;
  const pausingCount = pausesTools
    ? (status.stake?.requirement ?? []).filter((item) => item.minimum && remaining!.lt(toDecimal(item.minimum))).length
    : 0;
  const maturesAt = availableAfterRequest(state);
  const blocker = walletBlocker(wallet);

  const ready = state.phase === "ready" && state.unbonding;
  const steps = ready
    ? [
        withdrawStep({
          amountAtomic: state.unbonding!.amount,
          amountLabel: formatMoney(state.unbonding),
          signer: wallet.signer,
          chain: wallet.chain,
        }),
      ]
    : [unstakeStep({ amountAtomic: parsed.atomic ?? "0", amountLabel, signer: wallet.signer, chain: wallet.chain })];

  const timeline = (
    <StatusTimeline
      label="Withdrawal"
      orientation="horizontal"
      steps={[
        {
          id: "unbonding",
          label: "Unbonding",
          state: state.phase === "none" ? "upcoming" : state.phase === "unbonding" ? "current" : "done",
          date: state.startedAt,
          description: state.unbonding ? formatMoney(state.unbonding) : undefined,
        },
        {
          id: "withdrawable",
          label: "Withdrawable",
          state: state.phase === "ready" ? "current" : "upcoming",
          date: state.completesAt,
          countdown: state.phase === "unbonding",
        },
      ]}
    />
  );

  const chips: React.ReactNode[] = [];
  if (penalties.count > 0) {
    chips.push(
      <Link key="penalties" href={routes.penalties("needs-action")} className="underline-offset-2 hover:underline">
        {penalties.count === 1 ? "1 open penalty" : `${penalties.count} open penalties`} reserve part of your stake
      </Link>,
    );
  }
  if (pausingCount > 0) {
    chips.push(
      <Link key="tools" href="/provider/bindings" className="underline-offset-2 hover:underline">
        {pausingCount === 1 ? "1 paid tool" : `${pausingCount} paid tools`} would pause below the stake left
      </Link>,
    );
  }

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={ready ? "Withdraw your stake" : "Withdraw stake"}
      description={
        ready ? (
          <>{formatMoney(state.unbonding)} has finished unbonding and can go back to your wallet now.</>
        ) : (
          <>
            Stake comes back in two steps: it unbonds for a waiting period
            {periodLabel(state.periodMs) ? ` (${periodLabel(state.periodMs)})` : ""}, then you withdraw it to your
            wallet. The wait covers penalties for calls you already served.
          </>
        )
      }
      changes={
        !ready && parsed.value && state.staked
          ? [{ label: "Your stake", before: formatMoney(state.staked), after: formatDecimal(remaining!) }]
          : undefined
      }
      acknowledge={
        !ready && pausesTools ? "I understand paid tools above the stake that remains will be paused." : undefined
      }
      steps={steps}
      label={ready ? `Withdraw ${formatMoney(state.unbonding)}` : parsed.value ? `Start withdrawing ${amountLabel}` : "Start withdrawing"}
      resetKey={ready ? "ready" : value}
      disabled={(!ready && Boolean(parsed.error)) || Boolean(blocker) || (!ready && !state.staked)}
      disabledReason={
        !ready && !state.staked ? "You have no stake to withdraw." : !ready && parsed.error ? parsed.error : blocker
      }
      describeError={describeStakeError}
      successTitle={ready ? "Withdrawn to your wallet" : "Withdrawal started"}
      successDescription={
        ready
          ? "The money is in your stake wallet."
          : "It is unbonding now. Come back here when it is withdrawable; the date shows on the Stake page."
      }
      onSuccess={() => void queryClient.invalidateQueries({ queryKey: [...PROVIDER_STAKE_KEY] })}
      doneAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      {state.phase !== "none" ? timeline : null}

      {!ready ? (
        <>
          <PresetChips
            label="Amount to withdraw"
            presets={max ? [{ value: max, label: `Max ${formatMoney(state.staked)}` }] : []}
            value={value}
            onChange={setValue}
            error={value ? parsed.error : undefined}
            hint={state.staked ? `Staked now: ${formatMoney(state.staked)}` : undefined}
          />
          {parsed.value ? (
            <p className="text-body-13 text-02">
              Withdraw {amountLabel} →{" "}
              {maturesAt ? (
                <>
                  available on <LocalTime value={maturesAt} className="font-semibold text-01" />
                </>
              ) : (
                "available when the waiting period ends (the date shows here once you confirm)"
              )}
              .
            </p>
          ) : null}
          <p className="flex items-start gap-1.5 text-body-xs text-warning-700">
            <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>
              Each new request restarts the clock for the whole unbonding balance
              {state.unbonding ? `, including the ${formatMoney(state.unbonding)} already unbonding` : ""}.
            </span>
          </p>
        </>
      ) : null}

      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip, index) => (
            <li key={index} className="rounded-full bg-warning-10 px-2.5 py-1 text-label-xs text-warning-700">
              {chip}
            </li>
          ))}
        </ul>
      ) : null}
    </WalletActionSheet>
  );
}

