"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { PresetChips } from "@/components/patterns/preset-chips";
import { WalletActionSheet } from "@/components/patterns/sign-action";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { Button } from "@/components/ui/button";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { openPenaltyHold, openPenaltyPhrase } from "@/features/provider-penalties/model";
import { usePenalties } from "@/features/provider-penalties/use-penalties";
import { routes } from "@/libs/routes";
import { formatDecimal, formatMoney, parseAmountInput, toDecimal } from "@/utils/money";

import { stakeActionChain } from "./chain-stake";
import { trackSubmissions } from "./pending-chain-tx";
import { useProviderPendingTransactions } from "./pending-chain-tx-list";
import { describeStakeError, unstakeStep, withdrawStep } from "./stake-steps";
import { PROVIDER_STAKE_KEY, useStakeStatus } from "./use-stake-status";
import { useStakeWallet, walletBlocker } from "./use-stake-wallet";
import { simulatedSteps } from "./wallet-readiness";
import {
  availableAfterRequest,
  toolsPausedAt,
  waitingDuration,
  waitingPeriodOf,
  waitingPeriodPhrase,
  withdrawPlan,
  withdrawStateOf,
} from "./withdraw-state";
import { providerQueries } from "@/features/provider-home/queries";
import { useChainTerms } from "@/hooks/useChainTerms";

/**
 * "Withdraw stake": one sheet for both halves of getting stake back.
 *
 * 1. Start withdrawing an amount (Max chip). It unbonds for the waiting
 *    period, then becomes withdrawable. A new request restarts the clock for
 *    the WHOLE unbonding balance — said before the signature, not after.
 * 2. When the clock has ended, "Withdraw $X to your wallet".
 *
 * The amount starts at what is free: staked − what paid tools need − what
 * open penalties hold back, so the default never pauses anything. Going
 * above it names each tool that would pause and at which stake. Before the
 * signature a timeline shows the waiting period and the unlock date.
 *
 * Never shows a nonce, gas figure or chain id.
 */
export function WithdrawSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const status = useStakeStatus();
  const registration = useQuery(providerQueries.registration());
  const wallet = useStakeWallet(status);
  const penalties = usePenalties({ withCases: "none" });
  const names = useProviderToolNames();
  const queryClient = useQueryClient();
  const entry = stakeActionChain(status.stake ?? undefined);
  const { params: chainParams } = useChainTerms(entry?.chainId);
  const state = withdrawStateOf(entry);
  const decimals = state.staked?.decimals ?? status.required?.decimals ?? 6;

  const openPenalties = penalties.rows.filter((row) => row.tab !== "closed");
  const plan = withdrawPlan({
    staked: state.staked,
    required: status.required,
    reserved: openPenalties.map((row) => row.amount),
    requirement: status.stake?.requirement ?? [],
  });
  const freeValue = plan.free && toDecimal(plan.free).gt(0) ? toDecimal(plan.free).toFixed() : "";

  const [value, setValue] = React.useState("");
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    // Start at the amount that pauses nothing, once per opening.
    if (open && !wasOpen.current) setValue(freeValue);
    wasOpen.current = open;
  }, [open, freeValue]);

  const max = state.staked ? toDecimal(state.staked).toFixed() : undefined;
  const parsed = parseAmountInput(value, { decimals, max });
  const amountLabel = parsed.value ? formatDecimal(parsed.value) : "";
  const remaining = parsed.value && state.staked ? toDecimal(state.staked).minus(parsed.value) : null;
  const pausing =
    remaining !== null && parsed.atomic !== null && state.staked
      ? toolsPausedAt(plan, BigInt(state.staked.amount) - BigInt(parsed.atomic ?? "0"))
      : [];
  const pausesTools = pausing.length > 0;
  const waiting = waitingPeriodOf(state.periodMs, registration.data?.terms, chainParams?.unbondingPeriodSeconds);
  const periodKnown = waiting.exact;
  const maturesAt =
    availableAfterRequest(state) ?? (waiting.ms !== null ? new Date(Date.now() + waiting.ms).toISOString() : null);
  const blocker = walletBlocker(wallet);

  const ready = state.phase === "ready" && state.unbonding;
  const pending = useProviderPendingTransactions();
  const { connectWallet } = useConnectWallet();
  const realSteps = ready
    ? [
        withdrawStep({
          amountAtomic: state.unbonding!.amount,
          amountLabel: formatMoney(state.unbonding),
          signer: wallet.signer,
          chain: wallet.chain,
        }),
      ]
    : [unstakeStep({ amountAtomic: parsed.atomic ?? "0", amountLabel, signer: wallet.signer, chain: wallet.chain })];
  const steps = wallet.simulated
    ? simulatedSteps(realSteps)
    : trackSubmissions(
        realSteps,
        {
          kind: ready ? "withdraw" : "unstake",
          chainId: wallet.chainId,
          idPrefix: ready ? "withdraw" : "unstake",
          label: (step) => step.label,
        },
        pending,
      );

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

  const plannedTimeline = (
    <StatusTimeline
      label="What happens next"
      orientation="vertical"
      steps={[
        { id: "start", label: "Start withdrawing", state: "current", dateLabel: "Today, one signature" },
        {
          id: "wait",
          label: `Waiting period: ${waitingDuration(waiting)}`,
          state: "upcoming",
          description: "Covers penalties for calls you already served. The money stays staked and cannot be taken for new calls.",
        },
        {
          id: "unlock",
          label: periodKnown ? "Unlocks" : "Unlocks on or after",
          state: "upcoming",
          date: maturesAt,
        },
        { id: "withdraw", label: "Withdraw to your wallet", state: "upcoming", dateLabel: "Come back here, one signature" },
      ]}
    />
  );

  // Said on the chip itself, before anyone picks it: which paid tools taking everything out would pause.
  const pausedByAll = toolsPausedAt(plan, 0n).map((item) => names.toolName(item.toolId) ?? "a paid tool");
  const everythingNote =
    pausedByAll.length === 0
      ? undefined
      : pausedByAll.length <= 2
        ? `Pauses ${pausedByAll.join(" and ")}`
        : `Pauses all ${pausedByAll.length} paid tools`;

  const freeHint = state.staked
    ? [
        `Staked ${formatMoney(state.staked)}`,
        status.required ? `paid tools need ${formatMoney(status.required)}` : null,
        plan.reserved ? `open penalties hold ${formatMoney(plan.reserved)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

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
            Stake comes back in two steps: {waitingPeriodPhrase(waiting)}, then you withdraw it to your wallet.
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
      {wallet.canConnect ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<Wallet aria-hidden="true" />}
          className="self-start"
          onClick={() => connectWallet({ walletChainType: "ethereum-and-solana" })}
        >
          Connect your stake wallet
        </Button>
      ) : null}
      {state.phase !== "none" ? timeline : null}

      {!ready && state.staked ? (
        <div className="flex flex-col gap-1 rounded-lg border border-01 bg-02 px-3.5 py-3 text-body-13 text-02">
          <p>
            <span className="font-semibold text-01">{formatMoney(plan.free)}</span> is free to withdraw without pausing any tool.
          </p>
          {freeHint ? <p className="text-body-xs text-03">{freeHint}</p> : null}
          {plan.reserved ? (
            <Link href={routes.penalties("needs-action")} className="text-body-xs text-03 underline underline-offset-2">
              {openPenaltyPhrase(openPenaltyHold(penalties.rows))} hold {formatMoney(plan.reserved)} until they are
              settled
            </Link>
          ) : null}
        </div>
      ) : null}

      {!ready ? (
        <>
          <PresetChips
            label="Amount to withdraw"
            presets={[
              ...(freeValue ? [{ value: freeValue, label: `Max without pausing ${formatMoney(plan.free)}` }] : []),
              ...(max && max !== freeValue
                ? [{ value: max, label: `Everything ${formatMoney(state.staked)}`, description: everythingNote }]
                : []),
            ]}
            value={value}
            onChange={setValue}
            error={value ? parsed.error : undefined}
          />
          {pausesTools ? (
            <ul className="flex flex-col gap-1 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-warning-700">
              {pausing.map((item) => (
                <li key={item.bindingId}>
                  <Link href={routes.binding(item.bindingId)} className="font-semibold underline-offset-2 hover:underline">
                    {names.toolName(item.toolId) ?? "A paid tool"}
                  </Link>{" "}
                  pauses: it needs {formatMoney(item.minimum)} of stake and {formatDecimal(remaining!)} would be left.
                </li>
              ))}
            </ul>
          ) : null}
          {parsed.value ? (
            <p className="text-body-13 text-02">
              Withdraw {amountLabel}: unlocks {periodKnown ? "on" : "on or after"}{" "}
              <UtcTime value={maturesAt} dateOnly className="font-semibold text-01" />.
            </p>
          ) : null}
          {state.phase === "none" ? plannedTimeline : null}
          <p className="flex items-start gap-1.5 text-body-xs text-warning-700">
            <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>
              Each new request restarts the clock for the whole unbonding balance
              {state.unbonding ? `, including the ${formatMoney(state.unbonding)} already unbonding` : ""}.
            </span>
          </p>
        </>
      ) : null}

    </WalletActionSheet>
  );
}

