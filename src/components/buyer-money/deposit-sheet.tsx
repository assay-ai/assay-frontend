"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import * as React from "react";

import { DepositChainChoice } from "@/components/funding/deposit-chain-choice";
import { PresetChips } from "@/components/patterns/preset-chips";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { runApproveStep, runDepositStep, type DepositAttempt, type DepositRun } from "@/features/buyer-money/deposit-flow";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import { depositChoice } from "@/features/funding/deposit-chain";
import { depositUnavailableOn, depositableChains, offeredChains } from "@/features/funding/depositable-chains";
import { chainBalances } from "@/features/g30/balance";
import { usePendingTransactions } from "@/hooks/usePendingTransactions";
import { useSigner } from "@/hooks/useSigner";
import { evmRpcUrl } from "@/libs/chains/evm/chains";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { shortAddress } from "@/libs/chains/format";
import { isEvmChain } from "@/libs/chains/registry";
import { chainDisplayName, findChain, settlementSymbol } from "@/services/chains.service";
import { formatDecimal, parseAmountInput, toDecimal } from "@/utils/money";

import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";

/**
 * Add funds, in a drawer opened from anywhere (funding hero, Get started,
 * Overview, the account menu via `/funding?action=deposit`).
 *
 * - The amount starts empty: one careless click must not move $25.
 * - The $5 minimum is said before anyone types.
 * - One source line instead of a chain radio and a one-option select.
 * - Approve → Deposit as a tracked two-signature flow; "Confirmed" at the end.
 * - After a first deposit the next step is offered in place: set safety caps.
 */
const MINIMUM = "5";
const DECIMALS = 6;
const PRESETS = ["5", "20", "50"];

export interface DepositSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offered after success when the escrow has no safety caps yet. */
  onSetCaps?: () => void;
}

export function DepositSheet({ open, onOpenChange, onSetCaps }: DepositSheetProps) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const money = useBuyerMoney();
  const pending = usePendingTransactions();
  const [amount, setAmount] = React.useState("");
  const [picked, setPicked] = React.useState<string | null>(null);

  const depositable = depositableChains(money.chains, {
    status: money.escrowQuery.isPending ? "loading" : money.escrowQuery.isError ? "error" : "ready",
    chainId: money.chainId,
  });
  const choice = depositChoice(offeredChains(depositable));
  const chainId = choice.kind === "fixed" ? choice.chain.chainId : picked;
  const chain = chainId ? findChain(money.chains, chainId) : null;
  const chainName = chainId ? chainDisplayName(money.chains, chainId) : null;
  const symbol = (chainId && settlementSymbol(money.chains, chainId)) || "USD";
  const signerState = useSigner({ chainId });
  const walletBlocker = useWalletBlocker(signerState);
  const wallet = signerState.status === "ready" ? signerState.signer.address : null;

  const parsed = parseAmountInput(amount, { decimals: DECIMALS, min: MINIMUM });
  const showError = amount.trim() !== "" ? parsed.error : null;
  const row = chainId ? chainBalances(money.balancesQuery.data?.balances).find((b) => b.chainId === chainId) : undefined;
  const balanceNow = row ? toDecimal(row.available) : money.escrow?.spendable ? toDecimal(money.escrow.spendable) : null;
  const after = balanceNow && parsed.value ? balanceNow.plus(parsed.value) : null;
  const label = parsed.value ? `Deposit ${formatDecimal(parsed.value)}` : "Deposit";

  const unavailable = depositUnavailableOn(chainId, chainName, {
    kind: signerState.status === "ready" ? signerState.signer.kind : null,
    rpcConfigured: chainId !== null && isEvmChain(chainId) && evmRpcUrl(chainId) !== null,
  });

  // One run per attempt: created in the first step, read by the second.
  const runRef = React.useRef<DepositRun | null>(null);
  // Every way of closing (Done, Next, the X) starts the next opening empty.
  React.useEffect(() => {
    if (open) return;
    setAmount("");
    runRef.current = null;
  }, [open]);
  const resetKey = `${amount}|${chainId ?? ""}`;
  const evm = chainId !== null && isEvmChain(chainId);

  const steps: WalletStep[] = [
    {
      id: "approve",
      label: `Allow the deposit of ${parsed.value ? formatDecimal(parsed.value) : "this amount"} ${symbol}`,
      cost: "gas",
      skip: !evm,
      run: async ({ report, previousAttempt }) => {
        const signer = requireSigner(signerState);
        if (!runRef.current || runRef.current.amountAtomic !== parsed.atomic) {
          runRef.current = { chainId: chainId!, amountAtomic: parsed.atomic!, created: null, createdAt: 0 };
        }
        report({ stage: "preparing" });
        await runApproveStep(
          runRef.current,
          signer,
          (hash) => report({ stage: "submitted", data: hash, explorerUrl: chain ? explorerTxUrl(chain, hash) : undefined }),
          previousAttempt?.data as `0x${string}` | undefined,
        );
      },
    },
    {
      id: "deposit",
      label: `Deposit ${parsed.value ? formatDecimal(parsed.value) : ""} ${symbol}`.replace(/\s+/g, " "),
      cost: evm ? "gas" : "free",
      run: async ({ report, previousAttempt }) => {
        const signer = requireSigner(signerState);
        if (!runRef.current || runRef.current.amountAtomic !== parsed.atomic) {
          runRef.current = { chainId: chainId!, amountAtomic: parsed.atomic!, created: null, createdAt: 0 };
        }
        const run = runRef.current;
        report({ stage: "preparing" });
        const previous = previousAttempt?.data as DepositAttempt | undefined;
        let trackedId: string | null = previous?.kind === "hash" ? `deposit:${previous.depositId}` : null;
        try {
          const settled = await runDepositStep(run, signer, {
            onWallet: () => report({ stage: "wallet" }),
            previous,
            onSigned: (attempt) => report({ stage: "submitted", data: attempt }),
            onSubmitted: (hash, depositId) => {
              const explorerUrl = chain ? explorerTxUrl(chain, hash) : undefined;
              report({ stage: "submitted", data: { kind: "hash", hash, depositId } satisfies DepositAttempt, explorerUrl });
              trackedId = `deposit:${depositId}`;
              pending.track({
                id: trackedId,
                kind: "deposit",
                label,
                chainId: run.chainId,
                hash,
                explorerUrl,
                submittedAt: Date.now(),
                resume: { depositId, amountAtomic: run.amountAtomic },
              });
            },
          });
          if (trackedId) pending.resolve(trackedId);
          runRef.current = null;
          const ref = settled === "already-credited" ? null : settled.chainTxRef;
          return { data: settled, explorerUrl: ref && chain ? explorerTxUrl(chain, ref) : undefined };
        } finally {
          // Still pending after a failure: hand it to the list, which keeps checking it.
          if (trackedId) pending.release(trackedId);
        }
      },
    },
  ];

  const disabledReason = readOnly
    ? "Your account is blocked, so deposits are paused."
    : choice.kind === "none-offered"
      ? depositable.kind === "not-offered"
        ? "Deposits are not offered on the chain your account is on."
        : depositable.kind === "reading-account" || money.chainsStatus === "loading"
          ? "Reading which chain you are on…"
          : "We could not read which chains take deposits. Try again in a moment."
      : chainId === null
        ? "Choose a chain first."
        : unavailable
          ? unavailable
          : !parsed.value
            ? amount.trim() === ""
              ? "Pick or enter an amount."
              : (parsed.error ?? "Enter an amount.")
            : walletBlocker;

  const needsCaps = !money.capsSet;
  const close = () => onOpenChange(false);

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add funds"
      description="Money goes into your escrow, which only your wallet controls. Minimum $5.00."
      steps={steps}
      label={label}
      resetKey={resetKey}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      trackerNoun="Step"
      describeError={describeMoneyError}
      successTitle="Deposit confirmed on chain"
      successDescription={
        needsCaps
          ? "It shows in your balance within about a minute. Next: set safety caps, so your agents can pay."
          : "It shows in your balance within about a minute. Your agents can spend it within their caps."
      }
      onSuccess={() => {
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
        void queryClient.invalidateQueries({ queryKey: ["deposits"] });
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
      }}
      doneAction={
        needsCaps && onSetCaps
          ? { label: "Next: set safety caps", onClick: onSetCaps }
          : { label: "Done", onClick: close }
      }
    >
      {choice.kind === "choose" ? (
        <DepositChainChoice choice={choice} picked={picked} onPick={setPicked} busy={false} />
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-label-sm text-01">Amount</span>
        <PresetChips
          label="Deposit amount"
          presets={PRESETS}
          value={amount}
          onChange={setAmount}
          error={showError}
          hint={
            after
              ? `Balance after: ${formatDecimal(after)}`
              : "Minimum $5.00. You can withdraw what you do not spend."
          }
        />
      </div>

      {chainId ? (
        <p className="text-body-13 text-02" data-testid="deposit-source">
          From {wallet ? shortAddress(chainId, wallet) : "your wallet"} on {chainName} ·{" "}
          {evm ? "you pay a small network fee in ETH" : "network fee paid by Assay"}
        </p>
      ) : null}

      <details className="group rounded-lg border border-01 bg-02 px-3 py-2 text-body-xs text-02">
        <summary className="flex cursor-pointer select-none items-center gap-1.5 text-label-xs text-02">
          <Info aria-hidden="true" className="size-3.5" />
          About deposits
        </summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
          <li>
            You deposit {symbol}, a dollar token on {chainName ?? "this chain"}. It is spent on this chain only.
          </li>
          <li>Deposits settle on chain and are final: there is no card and no chargeback.</li>
          <li>You can withdraw what you have not spent at any time; it takes about an hour.</li>
          {evm ? <li>Two wallet prompts: one allows the transfer, one makes it. Both cost a little ETH.</li> : null}
        </ul>
      </details>
    </WalletActionSheet>
  );
}
