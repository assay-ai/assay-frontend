"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { DepositChainChoice } from "@/components/funding/deposit-chain-choice";
import { PresetChips } from "@/components/patterns/preset-chips";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import {
  runApproveStep,
  runDepositStep,
  warmWallet,
  type DepositAttempt,
  type DepositRun,
} from "@/features/buyer-money/deposit-flow";
import { DEPOSIT_CREDIT_TEXT } from "@/features/buyer-money/confirming";
import { testTokenHelp } from "@/features/buyer-money/gas-help";
import { describeMoneyError, describeSubmittedDepositError } from "@/features/buyer-money/money-errors";
import { DEPOSIT_MINIMUM_USD } from "@/features/explorer/buyer-costs";
import { depositChoiceFor } from "@/features/funding/deposit-chain";
import { depositWalletView, useDepositWallet } from "@/features/funding/deposit-wallet";
import { depositUnavailableOn, depositableChains, offeredChains } from "@/features/funding/depositable-chains";
import { chainBalances } from "@/features/g30/balance";
import { ME_STATUS_KEY } from "@/features/me-status/use-me-status";
import { usePendingTransactions } from "@/hooks/usePendingTransactions";
import { useSigner } from "@/hooks/useSigner";
import { demoEnabled } from "@/libs/demo/demo-api";
import { evmRpcUrl } from "@/libs/chains/evm/chains";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { shortAddress } from "@/libs/chains/format";
import { isEvmChain } from "@/libs/chains/registry";
import { chainDisplayName, findChain, settlementSymbol } from "@/services/chains.service";
import { formatDecimal, parseAmountInput, toDecimal } from "@/utils/money";

import { GasHelpNote } from "./gas-help-note";
import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";
import { chainTerms } from "@/libs/chain-terms";

/**
 * Add funds, in a drawer opened from anywhere (funding hero, Get started,
 * Overview, the account menu via `/funding?action=deposit`).
 *
 * - $20 is preselected (B7), so "Balance after" shows at once; nothing moves
 *   before the two wallet prompts.
 * - The wallet's own token and gas balances are read first (pinned token and
 *   escrow), so a short balance or no gas is warned about before any prompt,
 *   with an estimate of the network fee and of the time to credit. A warning
 *   only: the wallet's estimate stays the gate.
 * - The $5 minimum is said before anyone types.
 * - One source line instead of a chain radio and a one-option select.
 * - Approve → Deposit as a tracked two-signature flow; "Confirmed" at the end.
 * - After a first deposit the next step is offered in place: set the account ceiling.
 */
const MINIMUM = DEPOSIT_MINIMUM_USD;
const DECIMALS = 6;
const PRESETS = ["5", "20", "50"];
const PRESELECTED = "20";

export interface DepositSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offered after success when the escrow has no account ceiling yet. */
  onSetCaps?: () => void;
  /** Offer only this chain (the enable-paid page: the only RPC its policy reaches). */
  onlyChainId?: string | null;
}

export function DepositSheet({ open, onOpenChange, onSetCaps, onlyChainId = null }: DepositSheetProps) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const money = useBuyerMoney();
  const pending = usePendingTransactions();
  const [amount, setAmount] = React.useState(PRESELECTED);
  const [picked, setPicked] = React.useState<string | null>(null);

  const depositable = depositableChains(money.chains, {
    status: money.escrowQuery.isPending ? "loading" : money.escrowQuery.isError ? "error" : "ready",
    chainId: money.chainId,
  });
  const choice = depositChoiceFor(offeredChains(depositable), onlyChainId);
  const chainId = choice.kind === "fixed" ? choice.chain.chainId : picked;
  const chain = chainId ? findChain(money.chains, chainId) : null;
  const chainName = chainId ? chainDisplayName(money.chains, chainId) : null;
  const symbol = (chainId && settlementSymbol(money.chains, chainId)) || "USD";
  // `depositFor` credits the wallet that sends it, and the API refuses a sender
  // that is not the escrow's owner: ask for that wallet by address, so the
  // "From" line and the escrow's owner can never disagree.
  const ownerAddress = chainId !== null && chainId === money.chainId && money.owner ? money.owner : undefined;
  const signerState = useSigner({ chainId, address: ownerAddress });
  const walletBlocker = useWalletBlocker(signerState, ownerAddress ? money.ownerShort : null);
  const wallet = signerState.status === "ready" ? signerState.signer.address : (ownerAddress ?? null);

  const parsed = parseAmountInput(amount, { decimals: DECIMALS, min: MINIMUM });
  const showError = amount.trim() !== "" ? parsed.error : null;
  const row = chainId ? chainBalances(money.balancesQuery.data?.balances).find((b) => b.chainId === chainId) : undefined;
  const balanceNow = row ? toDecimal(row.available) : money.escrow?.spendable ? toDecimal(money.escrow.spendable) : null;
  const after = balanceNow && parsed.value ? balanceNow.plus(parsed.value) : null;
  const label = parsed.value ? `Deposit ${formatDecimal(parsed.value)}` : "Deposit";

  const unavailable = depositUnavailableOn(chainId, chainName, {
    kind: signerState.status === "ready" ? signerState.signer.kind : null,
    // DEMO ONLY: the sheet runs simulated steps that never build a transaction, so no RPC is needed.
    rpcConfigured: demoEnabled() || (chainId !== null && isEvmChain(chainId) && evmRpcUrl(chainId) !== null),
  });

  // One run per attempt: created in the first step, read by the second.
  const runRef = React.useRef<DepositRun | null>(null);
  // Every way of closing (Done, Next, the X) starts the next opening at the preselected amount.
  React.useEffect(() => {
    if (open) return;
    setAmount(PRESELECTED);
    runRef.current = null;
  }, [open]);
  // Warm the wallet as soon as the drawer is open, so a slow session refresh
  // is over before the click creates the intent (BUG-PROD-DEPOSIT-01).
  const readySigner = signerState.status === "ready" ? signerState.signer : null;
  React.useEffect(() => {
    if (open && readySigner) void warmWallet(readySigner);
  }, [open, readySigner]);
  const resetKey = `${amount}|${chainId ?? ""}`;
  const evm = chainId !== null && isEvmChain(chainId);
  // What the depositing wallet holds, before any prompt (pinned token and escrow; EVM only).
  const walletQuery = useDepositWallet({ chainId, address: wallet, enabled: open && evm });
  const walletView = depositWalletView({
    balances: walletQuery.data ?? null,
    amountAtomic: parsed.atomic ?? null,
    decimals: DECIMALS,
    tokenSymbol: symbol,
    nativeSymbol: "ETH",
  });

  const steps: WalletStep[] = [
    {
      id: "approve",
      label: parsed.value
        ? `Allow the escrow to take ${formatDecimal(parsed.value)} ${symbol}`
        : "Allow the escrow to take the amount",
      cost: "gas",
      skip: !evm,
      // No prompt at all when the allowance already covers the amount.
      mayNotPrompt: true,
      // Privy's details row wants a short action; the amount is in the description.
      promptTitle: `Approve ${symbol}`,
      promptDescription: parsed.value
        ? `Lets the Assay escrow take ${formatDecimal(parsed.value)} ${symbol} from your wallet for the deposit that follows. You pay the network fee.`
        : undefined,
      run: async ({ report, previousAttempt, prompt }) => {
        const signer = requireSigner(signerState, ownerAddress ? money.ownerShort : null, prompt);
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
      promptDescription: parsed.value
        ? `Moves ${formatDecimal(parsed.value)} ${symbol} from your wallet into your escrow, which only your wallet controls.${evm ? " You pay the network fee." : ""}`
        : undefined,
      run: async ({ report, previousAttempt, prompt }) => {
        const signer = requireSigner(signerState, ownerAddress ? money.ownerShort : null, prompt);
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
              // The same hash moved to a fresh intent: track that one, not the old.
              if (trackedId && trackedId !== `deposit:${depositId}`) pending.resolve(trackedId);
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
        : // No wallet yet is the common case and has a one-click fix, so it is
          // said first; "not available on this chain" is kept for the real case
          // (a connected wallet that still cannot build the transaction).
          walletBlocker
          ? walletBlocker
          : unavailable
            ? unavailable
            : !parsed.value
              ? amount.trim() === ""
                ? "Pick or enter an amount."
                : (parsed.error ?? "Enter an amount.")
              : null;

  const needsCaps = !money.capsSet;
  const tokenHelp = testTokenHelp(chain);
  const close = () => onOpenChange(false);

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      title="Add funds"
      description="Money goes into your escrow, which only your wallet controls."
      steps={steps}
      label={label}
      resetKey={resetKey}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      trackerNoun="Step"
      describeError={describeMoneyError}
      describeSubmittedError={describeSubmittedDepositError}
      successTitle="Deposit confirmed on chain"
      successDescription={
        needsCaps
          ? `${DEPOSIT_CREDIT_TEXT} Next: set your account ceiling, so your agents can pay.`
          : `${DEPOSIT_CREDIT_TEXT} Your agents can then spend it within their spending limits.`
      }
      onSuccess={() => {
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
        void queryClient.invalidateQueries({ queryKey: ["deposits"] });
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        // The debts ride on `GET /me/status` now; they refreshed with the escrow before.
        void queryClient.invalidateQueries({ queryKey: ME_STATUS_KEY });
      }}
      doneAction={
        needsCaps && onSetCaps
          ? { label: "Next: set your account ceiling", onClick: onSetCaps }
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
        <p className="text-body-13 text-02 [overflow-wrap:anywhere]" data-testid="deposit-source">
          From {wallet ? shortAddress(chainId, wallet) : "your wallet"} on {chainName} ·{" "}
          {evm ? "you pay a small network fee in ETH" : "network fee paid by Assay"} · usually credited in under a minute
        </p>
      ) : null}

      {walletView.rows.length > 0 ? (
        <dl className="flex flex-col gap-1 rounded-lg border border-01 bg-02 px-3 py-2 text-body-xs" data-testid="deposit-wallet">
          {walletView.rows.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt className="text-02">{row.label}</dt>
              <dd className={row.bad ? "font-mono text-warning-700" : "font-mono text-01"}>{row.value}</dd>
            </div>
          ))}
          {walletView.feeText ? <p className="pt-1 text-03">{walletView.feeText}</p> : null}
          {/* A warning, never a block: the wallet's own estimate is the gate. */}
          {walletView.warning ? (
            <p className="pt-1 text-warning-700" data-testid="deposit-wallet-warning">
              {walletView.warning}
            </p>
          ) : null}
        </dl>
      ) : null}
      {/* Where to get test ETH and the test token: only when the wallet lacks it, or its balances are unknown. */}
      {evm && (walletView.needsGas || !walletQuery.data) ? <GasHelpNote chain={chain} /> : null}
      {tokenHelp && (walletView.needsToken || !walletQuery.data) ? (
        <p className="text-body-xs text-03" data-testid="test-token-help">
          {tokenHelp}
        </p>
      ) : null}

      {/* Money truths stay visible: a deposit is final, and getting it back takes the chain's withdrawal delay. */}
      <ul className="flex list-disc flex-col gap-1 rounded-lg border border-01 bg-02 py-2 pl-7 pr-3 text-body-xs text-02" data-testid="deposit-truths">
        <li>
          You deposit {symbol}, a dollar token on {chainName ?? "this chain"}, spent on this chain only.
          {evm ? " Two wallet prompts: one allows the transfer, one makes it." : ""}
        </li>
        <li>Deposits settle on chain and are final: there is no card and no chargeback.</li>
        <li>You can withdraw what you have not spent at any time; it takes about {chainTerms(chain).withdrawDelay}.</li>
      </ul>
    </WalletActionSheet>
  );
}
