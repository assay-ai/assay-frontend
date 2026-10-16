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

import { debtDeadline, debtStateOf, debtsToSign, settledToast, splitDebts } from "./debt-copy";
import {
  balanceAfterSettling,
  debtTotal,
  paidCallsAfterSettling,
  resumesAfterSettling,
  settleReadiness,
} from "./debt-summary";
import { settleDebt } from "./settle-debt";
import { refreshesDebts, settleDebtFailure } from "./settle-debt-errors";

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
    enabled: hasBlockStatusSession({ ready, authenticated, hasStoredToken }),
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
  const [debts, setDebts] = React.useState<BuyerDebt[] | null>(null);
  if (open && debts === null && query.data) {
    const toSign = debtsToSign(splitDebts(query.data).own);
    setDebts(intentId ? toSign.filter((debt) => debt.intentId === intentId) : toSign);
  }
  const settling = debts ?? [];
  const total = debtTotal(settling);
  const totalText = total ? formatMoney(total, { decimals: 4 }) : `${settling.length} payments`;
  const balance = escrow.data?.balance ?? null;
  const balanceAfter = balanceAfterSettling(balance, settling);
  const after = balanceAfter?.after ?? null;
  const blocks = settleReadiness(escrow.data ?? null, settling);
  const escrowUnread = escrow.isError || escrow.data?.chainReadable === false;
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
  const disabledReason = readOnly
    ? "Your account is blocked, so nothing can be signed now. Contact Assay support."
    : nothingToSign
      ? "Nothing left for this wallet to sign: it is settled, being collected, or owed by another wallet."
      : blocks.length > 0
        ? `Not yet: ${blocks.map((block) => block.text).join(" ")}`
        : escrow.isPending && settling.length > 0
          ? "Checking your escrow balance and ceilings first…"
          : walletBlocker;

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
      changes={settling.length > 0 ? changes : undefined}
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
      {blocks.length > 0 ? (
        <section
          aria-labelledby="settle-first"
          className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-3"
          data-testid="settle-blocked"
        >
          <h3 id="settle-first" className="text-label-13 text-warning-700">
            Do this first, or the payment cannot be collected
          </h3>
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
      ) : escrowUnread && settling.length > 0 ? (
        <p className="text-body-13 text-warning-700" data-testid="settle-escrow-unread">
          Your escrow could not be read, so its balance and ceilings are not checked here. If it cannot pay this, the
          collection fails and the debt stays open.
        </p>
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
                      : `. Settle by ${debtDeadline(debt.writeOffAt)}, or the provider goes unpaid.`}
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
