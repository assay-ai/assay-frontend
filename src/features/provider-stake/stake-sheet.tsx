"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Wallet } from "lucide-react";
import * as React from "react";

import { PresetChips } from "@/components/patterns/preset-chips";
import { WalletActionSheet } from "@/components/patterns/sign-action";
import { Button } from "@/components/ui/button";
import type { Money, ProviderStake } from "@/interfaces";
import { formatDecimal, formatMoney, parseAmountInput, toDecimal } from "@/utils/money";

import { withProvedStakeAuthority } from "./chain-stake";
import { trackSubmissions } from "./pending-chain-tx";
import { useProviderPendingTransactions } from "./pending-chain-tx-list";
import { stakePreflight, useStakeBalances } from "./stake-preflight";
import { depositSteps, describeStakeError, proveWalletStep } from "./stake-steps";
import { PROVIDER_STAKE_KEY, useStakeStatus } from "./use-stake-status";
import { STAKE_REDUCED_ONLY_BY, stakeAfterSentence } from "./stake-status";
import { short, useStakeWallet, walletBlocker } from "./use-stake-wallet";
import { simulatedSteps } from "./wallet-readiness";
import { useWalletChainType } from "@/hooks/useWalletChainType";

/** The gas token of every pinned stake deployment (Robinhood Chain; see `deployments.ts`). */
const NATIVE_SYMBOL = "ETH";

/**
 * THE Stake sheet: one `WalletActionSheet` that every surface opens (Stake
 * page, wizard Go live, Home checklist and Needs-action strip).
 *
 * Steps inside: (1) "Confirm this wallet holds your stake" when the stake
 * wallet is not proved yet (chain from the connected wallet, no typing);
 * (2) the amount, prefilled with `amount` (or the shortfall) and a
 * recommended 1.5× chip; (3) approve + deposit with the signature tracker.
 */
export interface StakeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill: the amount to add (e.g. the shortfall for a binding about to go live). */
  amount?: Money | null;
  /** One line on why the stake is asked for here ("Your tool needs $100 to take paid calls"). */
  reason?: React.ReactNode;
  /** After the deposit is confirmed and the stake re-read. */
  onStaked?: () => void;
}

/** Major units for an input, rounded up to cents so a prefill always covers the need. */
export function inputFromMoney(money: Money | null | undefined): string {
  if (!money) return "";
  const value = toDecimal(money);
  if (value.lte(0)) return "";
  return value.toDecimalPlaces(2, Decimal.ROUND_UP).toFixed();
}

export function StakeSheet({ open, onOpenChange, amount, reason, onStaked }: StakeSheetProps) {
  const status = useStakeStatus();
  const wallet = useStakeWallet(status);
  const queryClient = useQueryClient();
  const { connectWallet } = useConnectWallet();
  // From the served chains: no Solana wallet offered while only EVM chains are served.
  const walletChainType = useWalletChainType();
  const decimals = status.required?.decimals ?? status.staked?.decimals ?? 6;

  const needed = amount ?? status.shortfall ?? null;
  const recommendedTopUp = React.useMemo(() => {
    if (!status.recommended) return null;
    const gap = toDecimal(status.recommended).minus(status.staked ? toDecimal(status.staked) : 0);
    return gap.gt(0) ? gap : null;
  }, [status.recommended, status.staked]);

  const [value, setValue] = React.useState("");
  // Fixed while the sheet is open, so proving mid-run does not renumber the steps.
  const [needsProof, setNeedsProof] = React.useState(!wallet.proved);
  // Prefill once per opening: the need, else the recommended top-up.
  React.useEffect(() => {
    if (!open) return;
    setNeedsProof(!wallet.proved);
    setValue(inputFromMoney(needed) || (recommendedTopUp ? recommendedTopUp.toDecimalPlaces(2, Decimal.ROUND_UP).toFixed() : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = parseAmountInput(value, { decimals });
  const amountLabel = parsed.value ? formatDecimal(parsed.value) : "";

  const presets = [
    ...(needed && toDecimal(needed).gt(0)
      ? [{ value: inputFromMoney(needed), label: formatMoney(needed), description: "Needed now" }]
      : []),
    ...(recommendedTopUp
      ? [
          {
            value: recommendedTopUp.toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(),
            label: formatDecimal(recommendedTopUp.toDecimalPlaces(2, Decimal.ROUND_UP)),
            description: "Recommended (1.5× what you need)",
          },
        ]
      : []),
  ].filter((p, i, all) => all.findIndex((q) => q.value === p.value) === i);

  const pending = useProviderPendingTransactions();
  const balances = useStakeBalances({
    chainId: wallet.chainId,
    address: wallet.address,
    enabled: open && wallet.isEvm && !wallet.simulated,
  });
  const preflight = stakePreflight({
    balances: balances.data ?? null,
    amountAtomic: parsed.atomic,
    decimals,
    tokenSymbol: wallet.tokenSymbol,
    nativeSymbol: NATIVE_SYMBOL,
  });

  const realSteps = [
    proveWalletStep({
      chainId: wallet.chainId,
      address: wallet.address,
      signer: wallet.signer,
      skip: !needsProof,
      onProved: (stakeAuthority) =>
        queryClient.setQueryData<ProviderStake>([...PROVIDER_STAKE_KEY], (previous) =>
          withProvedStakeAuthority(previous, stakeAuthority),
        ),
    }),
    ...depositSteps({
      amountAtomic: parsed.atomic ?? "0",
      amountLabel,
      isEvm: wallet.isEvm,
      signer: wallet.signer,
      chain: wallet.chain,
    }),
  ];
  const steps = wallet.simulated
    ? simulatedSteps(realSteps)
    : trackSubmissions(
        realSteps,
        {
          kind: "stake",
          chainId: wallet.chainId,
          idPrefix: "stake",
          label: (step) => (step.id === "approve" ? `Approve ${amountLabel} for your stake` : `Stake ${amountLabel}`),
        },
        pending,
      );

  const blocker = walletBlocker(wallet) ?? preflight.blocker;
  const after = parsed.value && status.staked ? toDecimal(status.staked).plus(parsed.value) : parsed.value;

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add stake"
      description={
        // The caller's reason (the stake status) first, then what can reduce stake, always (D21).
        typeof reason === "string" || reason === null || reason === undefined || reason === false ? (
          `${typeof reason === "string" && reason.trim() ? `${reason.trim()} ` : "Stake is the deposit that lets your tools take paid calls. "}${STAKE_REDUCED_ONLY_BY}`
        ) : (
          <>
            {reason} {STAKE_REDUCED_ONLY_BY}
          </>
        )
      }
      changes={
        parsed.value
          ? [
              {
                label: "Your stake",
                before: status.staked ? formatMoney(status.staked) : "$0.00",
                after: after ? formatDecimal(after) : "—",
              },
            ]
          : undefined
      }
      steps={steps}
      label={parsed.value ? `Stake ${amountLabel}` : "Stake"}
      resetKey={`${value}|${wallet.address}`}
      disabled={Boolean(parsed.error) || Boolean(blocker)}
      disabledReason={parsed.error ?? blocker}
      describeError={describeStakeError}
      successTitle={`${amountLabel} staked`}
      successDescription="Your stake updates here within about a minute, once Assay reads the chain."
      onSuccess={() => {
        void queryClient.invalidateQueries({ queryKey: [...PROVIDER_STAKE_KEY] });
        onStaked?.();
      }}
      doneAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      <div className="flex flex-col gap-1.5 rounded-lg border border-01 bg-02 px-3.5 py-3">
        <span className="text-label-13 text-01">From your wallet</span>
        {wallet.address ? (
          <span className="text-body-13 text-02">
            <span className="font-mono text-mono-13 text-01">{short(wallet.address)}</span> on {wallet.chainName}
            {wallet.proved ? " · your stake wallet" : ""}
          </span>
        ) : (
          <span className="text-body-13 text-02">No wallet for {wallet.chainName} is connected in this browser.</span>
        )}
        {!wallet.proved && wallet.candidates.length > 1 ? (
          <label className="flex flex-col gap-1 pt-1 text-body-xs text-03">
            Use another connected wallet
            <select
              className="rounded-md border border-02 bg-01 px-2.5 py-2 font-mono text-mono-13 text-01"
              value={wallet.address}
              onChange={(event) => wallet.pick(event.target.value)}
            >
              {wallet.candidates.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {short(candidate)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!wallet.proved ? (
          <span className="text-body-xs text-03">
            The first signature is free: it proves this wallet is yours. Penalties and withdrawals then
            only ever touch this wallet&apos;s stake.
          </span>
        ) : null}
        {wallet.canConnect ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<Wallet aria-hidden="true" />}
            className="self-start"
            onClick={() => connectWallet({ walletChainType })}
          >
            Connect a wallet
          </Button>
        ) : null}
      </div>
      <PresetChips
        label="Amount to stake"
        presets={presets}
        value={value}
        onChange={setValue}
        error={value ? parsed.error : undefined}
        hint={
          status.required
            ? [
                `Your paid tools need ${formatMoney(status.required)} (the most any one of them needs); you have ${status.staked ? formatMoney(status.staked) : "$0.00"}.`,
                stakeAfterSentence(after ?? null, status.required, status.recommended),
              ]
                .filter(Boolean)
                .join(" ")
            : "You can stake before you list a paid tool."
        }
      />
      {preflight.rows.length > 0 ? (
        <dl className="flex flex-col gap-1 rounded-lg border border-01 px-3.5 py-2.5 text-body-13">
          <span className="text-label-13 text-01">Before you sign</span>
          {preflight.rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <dt className="text-02">{row.label}</dt>
              <dd className={row.bad ? "font-mono text-mono-13 text-danger-600" : "font-mono text-mono-13 text-01"}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : balances.isError ? (
        <p className="text-body-xs text-03">
          We could not read this wallet&apos;s balance. Your wallet will say if it does not hold enough.
        </p>
      ) : null}
      {wallet.isEvm ? (
        <p className="text-body-xs text-03">
          Two signatures in your wallet. Step 1: approve, which lets the stake contract move this amount. Step 2: deposit,
          which moves it into your stake. Each costs a small network fee.
        </p>
      ) : null}
    </WalletActionSheet>
  );
}
