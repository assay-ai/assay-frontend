"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import Link from "next/link";

import { usePauseAll } from "@/components/buyer-money/pause-all";
import { requireSigner, useEscrowQuery, useWalletBlocker } from "@/components/buyer-money/use-buyer-money";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/patterns/local-time";
import { WalletActionSheet, type WalletStep, type WalletStepResult } from "@/components/patterns/sign-action";
import { hasBlockStatusSession } from "@/features/account-block/state";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { debtCauseText } from "@/features/call-classes/labels";
import { useChains } from "@/hooks/useChains";
import { useEntityNames } from "@/hooks/useEntityNames";
import { useSigner } from "@/hooks/useSigner";
import type { BuyerDebt, BuyerDebts, SettleDebtResult } from "@/interfaces/buyer-debt";
import { ApiError, getSessionToken } from "@/libs/ApiClient";
import { shortAddress } from "@/libs/chains/format";
import { demoEnabled } from "@/libs/demo/demo-api";
import { markDemoDebtsSigned } from "@/libs/demo/demo-debts";
import { findChain } from "@/services/chains.service";
import { createDebtVoucherIntent, getBuyerDebts, submitDebtVoucher } from "@/services/escrow.service";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { formatMoney } from "@/utils/money";

import { debtDeadline, debtStateOf, debtsToSign, isReplaceable, settledToast, splitDebts } from "./debt-copy";
import {
  balanceAfterSettling,
  debtTotal,
  paidCallsAfterSettling,
  resumesAfterSettling,
  settleBlockedSummary,
  settleEscrowCheck,
  waitingToSettleNote,
} from "./debt-summary";
import { settleDebt } from "./settle-debt";
import { refreshesDebts, settleDebtFailure } from "./settle-debt-errors";
import { useReplaceableNow } from "./use-replaceable-now";

export const BUYER_DEBTS_KEY = ["escrow", "debts"] as const;

/**
 * `GET /escrow/debts`, shared by the banner, the settle sheet, call rows and
 * the receipt (one query key, so one request). Nothing is owed while the read
 * fails: an older backend has no such route.
 */
export function useBuyerDebtsQuery() {
  const { ready, authenticated } = usePrivy();
  const [hasStoredToken, setHasStoredToken] = React.useState(false);
  React.useEffect(() => setHasStoredToken(getSessionToken() !== null), []);
  return useQuery<BuyerDebts, ApiError>({
    queryKey: BUYER_DEBTS_KEY,
    queryFn: getBuyerDebts,
    // The demo answers from fixtures with no session, like its other data.
    enabled: demoEnabled() || hasBlockStatusSession({ ready, authenticated, hasStoredToken }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 0,
  });
}

/* ------------------------------------------------------------------ */

interface SettleDebtContextValue {
  /** Open the settle sheet: for one call (`intentId`), or for every debt this wallet can sign. */
  openSettle: (intentId?: string) => void;
}

const SettleDebtContext = React.createContext<SettleDebtContextValue>({ openSettle: () => {} });

export function useSettleDebt(): SettleDebtContextValue {
  return React.useContext(SettleDebtContext);
}

/**
 * Mounted once in the buyer shell: holds the settle sheet so the banner, a
 * call row, the receipt and Spend all open the same flow.
 */
export function SettleDebtProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<{ intentId?: string; at: number; open: boolean } | null>(null);
  // Mounted from the first opening on (not before, so pages that never settle
  // do not read the escrow for it), and kept so closing still animates.
  const [used, setUsed] = React.useState(false);
  const value = React.useMemo<SettleDebtContextValue>(
    () => ({
      openSettle: (intentId) => {
        setUsed(true);
        setRequest({ intentId, at: Date.now(), open: true });
      },
    }),
    [],
  );
  return (
    <SettleDebtContext.Provider value={value}>
      {children}
      {used ? (
        <SettleDebtSheet
          key={request?.at ?? 0}
          open={request?.open === true}
          intentId={request?.intentId}
          onOpenChange={(open) => {
            if (!open) setRequest((current) => (current ? { ...current, open: false } : current));
          }}
        />
      ) : null}
    </SettleDebtContext.Provider>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Settling buyer debt as a wallet sheet: what is owed and why, what the
 * wallet signs (decoded from the debt, which `settle-debt.ts` checks the
 * voucher against before the wallet is asked), the cost (free: a signature,
 * no gas), the escrow balance after, and one signature per call. The signing
 * itself is `settleDebt` unchanged.
 */
function SettleDebtSheet({
  open,
  intentId,
  onOpenChange,
}: {
  open: boolean;
  intentId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useBuyerDebtsQuery();
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const escrow = useEscrowQuery();
  const { chains } = useChains();
  const names = useEntityNames({ kinds: ["tool", "provider"] });

  const account = query.data?.account ?? null;
  const chainId = chainIdOfAccount(account);
  const owner = addressOfAccount(account) || undefined;
  const signerState = useSigner({ chainId, address: owner });
  const ownerShort = chainId && owner ? shortAddress(chainId, owner) : null;
  const walletBlocker = useWalletBlocker(signerState, ownerShort);
  const chain = chainId ? findChain(chains, chainId) : null;

  /*
    The debts to settle are fixed when the sheet opens: a refetch in the
    middle of the signatures must not renumber the steps under the person.
  */
  /*
    Only debts past their `replaceableAt` are signed: before it the original
    voucher can still be collected on chain, so the backend refuses the
    replacement (`PAYMENT_DEBT_NOT_YET_REPLACEABLE`) — the buyer never pays
    twice. The waiting ones are named, with the time they can be settled.
  */
  const [debts, setDebts] = React.useState<{ ready: BuyerDebt[]; waitingNote: string | null } | null>(null);
  const now = useReplaceableNow(query.data, query.dataUpdatedAt);
  if (open && debts === null && query.data) {
    const own = debtsToSign(splitDebts(query.data).own);
    const toSign = intentId ? own.filter((debt) => debt.intentId === intentId) : own;
    setDebts({ ready: toSign.filter((debt) => isReplaceable(debt, now)), waitingNote: waitingToSettleNote(toSign, now) });
  }
  const settling = debts?.ready ?? [];
  const waitingNote = debts?.waitingNote ?? null;
  const total = debtTotal(settling);
  const totalText = total ? formatMoney(total, { decimals: 4 }) : `${settling.length} payments`;
  const balance = escrow.data?.balance ?? null;
  const balanceAfter = balanceAfterSettling(balance, settling);
  const after = balanceAfter?.after ?? null;
  const check = settleEscrowCheck(
    { data: escrow.data ?? null, isError: escrow.isError, isPending: escrow.isPending },
    settling,
  );
  const blocks = check.kind === "blocked" ? check.blocks : [];
  const blockedSummary = settleBlockedSummary(settling, blocks);
  const resumes = resumesAfterSettling(query.data, settling);
  const { paused: pausedByYou } = usePauseAll();
  const paidCalls = paidCallsAfterSettling({ resumes, pausedByYou, blocked: readOnly });
  const [lastResult, setLastResult] = React.useState<SettleDebtResult | null>(null);

  const toolName = (toolId: string) => names.name("tool", toolId);
  const providerName = (providerId: string | null) => (providerId ? names.name("provider", providerId) : "the provider");

  const steps: WalletStep[] = settling.map((debt, index) => ({
    id: debt.intentId,
    label:
      settling.length === 1
        ? `Sign the payment: ${formatMoney(debt.amount, { decimals: 4 })}`
        : `Payment ${index + 1}: ${formatMoney(debt.amount, { decimals: 4 })} · ${toolName(debt.toolId)}`,
    cost: "free",
    run: async ({ report }): Promise<WalletStepResult> => {
      const signer = requireSigner(signerState, ownerShort);
      report({ stage: "preparing" });
      try {
        const result = await settleDebt(debt, signer, {
          createIntent: async (id) => {
            const intent = await createDebtVoucherIntent(id);
            report({ stage: "wallet" });
            return intent;
          },
          submit: submitDebtVoucher,
        });
        setLastResult(result);
        return { data: result };
      } catch (error) {
        if (refreshesDebts(error)) void queryClient.invalidateQueries({ queryKey: BUYER_DEBTS_KEY });
        throw error;
      }
    },
  }));

  const nothingToSign = query.data !== undefined && settling.length === 0;
  const nothingReason = nothingToSign
    ? (waitingNote ??
      "Nothing left for this wallet to sign: it is settled, being collected, or owed by another wallet.")
    : null;
  const disabledReason = readOnly
    ? "Your account is blocked, so nothing can be signed now. Contact Assay support."
    : nothingReason
      ? nothingReason
      : blocks.length > 0
        ? `Not yet: ${blocks.map((block) => block.text).join(" ")}`
        : check.kind === "pending" && settling.length > 0
          ? "Checking your escrow balance and ceilings first…"
          : walletBlocker;

  // While signing is blocked these before → after rows would promise the outcome
  // ("$0.00", "Resume in about a minute"), so the sheet shows them only when it
  // can sign; the blocked section says what is owed, what is missing and the next step.
  const changes = [
    { label: "You owe", before: totalText, after: formatMoney(null) },
    ...(balance && balanceAfter
      ? [
          {
            label: "Escrow balance",
            before: formatMoney(balance, { decimals: 4 }),
            after: balanceAfter.after
              ? formatMoney(balanceAfter.after, { decimals: 4 })
              : `Short by ${formatMoney(balanceAfter.shortBy, { decimals: 4 })}`,
          },
        ]
      : []),
    { label: "Paid calls", before: "Paused", after: paidCalls.short },
  ];

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      chain={chain}
      title={settling.length > 1 ? `Settle ${totalText} for ${settling.length} calls` : `Settle ${totalText} owed for a call`}
      description="Your agent already made and used this call, but its payment could not be collected. You sign the payment again; it is taken from your escrow within about a minute and paid to the provider."
      changes={settling.length > 0 && blocks.length === 0 ? changes : undefined}
      steps={steps}
      label={settling.length > 1 ? `Sign ${settling.length} payments · ${totalText} (free)` : `Sign to pay ${totalText} (free, no gas)`}
      resetKey={settling.map((debt) => debt.intentId).join("|")}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      describeError={settleDebtFailure}
      successTitle={`Signed. Collecting ${totalText} from your escrow`}
      successDescription={
        <>
          {lastResult && lastResult.remainingDebts > 0 ? settledToast(lastResult.remainingDebts) : paidCalls.sentence}
          {after ? ` Escrow balance after: ${formatMoney(after, { decimals: 4 })}.` : null}
        </>
      }
      onSuccess={() => {
        if (demoEnabled()) markDemoDebtsSigned(settling.map((debt) => debt.intentId));
        void queryClient.invalidateQueries({ queryKey: BUYER_DEBTS_KEY });
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        void queryClient.invalidateQueries({ queryKey: ["tool-calls"] });
      }}
      doneAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      {query.isPending ? <p className="text-body-13 text-03">Reading what is owed…</p> : null}
      {waitingNote && settling.length > 0 ? (
        <p className="text-body-13 text-02 [overflow-wrap:anywhere]" data-testid="settle-not-yet">
          {waitingNote}
        </p>
      ) : null}
      {blocks.length > 0 ? (
        <section
          aria-labelledby="settle-first"
          className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-3"
          data-testid="settle-blocked"
        >
          <h3 id="settle-first" className="text-label-13 text-warning-700">
            Do this first, or the payment cannot be collected
          </h3>
          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-13" data-testid="settle-blocked-summary">
            {blockedSummary.map((row) => (
              <React.Fragment key={row.label}>
                <dt className="text-02">{row.label}</dt>
                <dd className="text-warning-700 [overflow-wrap:anywhere]">{row.value}</dd>
              </React.Fragment>
            ))}
          </dl>
          {blocks.map((block) => (
            <div key={block.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className="min-w-0 flex-1 text-body-13 text-warning-700">{block.text}</p>
              <Button size="sm" variant="secondary" asChild>
                <Link href={block.action.href} onClick={() => onOpenChange(false)}>
                  {block.action.label}
                </Link>
              </Button>
            </div>
          ))}
        </section>
      ) : check.kind === "unread" && settling.length > 0 ? (
        <p className="text-body-13 text-warning-700" data-testid="settle-escrow-unread">
          Your escrow could not be read, so its balance and ceilings are not checked here. If it cannot pay this, the
          collection fails and the debt stays open.
        </p>
      ) : check.kind === "ok" && settling.length > 0 ? (
        <section aria-labelledby="settle-checked" className="flex flex-col gap-1.5" data-testid="settle-checked">
          <h3 id="settle-checked" className="text-label-13 text-01">
            Checked: your escrow can pay it
          </h3>
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-13">
            {check.rows.map((row) => (
              <React.Fragment key={row.label}>
                <dt className="text-03">{row.label}</dt>
                <dd className="text-01 [overflow-wrap:anywhere]">{row.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ) : null}
      {settling.length > 0 ? (
        <section aria-labelledby="settle-what-you-sign" className="flex flex-col gap-2">
          <h3 id="settle-what-you-sign" className="text-label-13 text-01">
            What you sign
          </h3>
          <ul className="flex flex-col gap-2">
            {settling.map((debt) => (
              <li key={debt.intentId} className="rounded-lg border border-01 bg-02 px-3.5 py-3" data-testid="settle-debt-item">
                <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body-13">
                  <dt className="text-03">Pays</dt>
                  <dd className="font-mono text-mono-13 font-semibold text-01">{formatMoney(debt.amount, { decimals: 4 })}</dd>
                  <dt className="text-03">To</dt>
                  <dd className="text-01 [overflow-wrap:anywhere]">{providerName(debt.providerId)}</dd>
                  <dt className="text-03">For</dt>
                  <dd className="text-01 [overflow-wrap:anywhere]">
                    a <span className="font-mono text-mono-13">{toolName(debt.toolId)}</span> call,{" "}
                    <LocalTime value={debt.createdAt} midSentence />
                  </dd>
                  <dt className="text-03">From</dt>
                  <dd className="text-01 [overflow-wrap:anywhere]">your escrow{ownerShort ? ` (${ownerShort})` : ""}</dd>
                  <dt className="text-03">Why</dt>
                  <dd className="text-02 [overflow-wrap:anywhere]">
                    {debtCauseText(debt.cause)}
                    {debtStateOf(debt) === "WRITTEN_OFF"
                      ? `. Written off on ${debtDeadline(debt.writeOffAt)}: the provider was not paid; this pays them.`
                      : `. Settle by ${debtDeadline(debt.writeOffAt)}; after that it is written off, but still owed.`}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
          <p className="text-body-xs text-03">
            Before your wallet opens, Assay checks the request pays exactly this amount, from your wallet, into your
            escrow contract, for this call. Anything else is refused and nothing is signed.
          </p>
          <p className="text-body-xs text-02" data-testid="settle-final">
            Once collected, a payment cannot be taken back.
          </p>
        </section>
      ) : null}
    </WalletActionSheet>
  );
}
