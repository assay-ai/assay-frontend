"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useToolNames } from "@/components/g31/use-tool-names";
import { bannerVariants } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { hasBlockStatusSession } from "@/features/account-block/state";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import type { BuyerDebts } from "@/interfaces/buyer-debt";
import { ApiError, getSessionToken } from "@/libs/ApiClient";
import { createDebtVoucherIntent, getBuyerDebts, submitDebtVoucher } from "@/services/escrow.service";
import { cn } from "@/utils";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { toast } from "@/utils/toast";

import {
  debtBannerDescription,
  debtBannerTitle,
  debtRowText,
  debtsToSign,
  isReplaceable,
  nextReplaceableAt,
  notYetReplaceableSentence,
  settledToast,
  settleDebtErrorSentence,
  splitDebts,
} from "./debt-copy";
import { settleDebt } from "./settle-debt";

export const BUYER_DEBTS_KEY = ["escrow", "debts"] as const;

/**
 * The buyer-debt banner, mounted once in the buyer shell, so it is above the
 * console, the funding and escrow screens and the agents page alike.
 *
 * Reads `GET /escrow/debts`. Nothing shows while there is no debt, or when
 * the read fails (an older backend has no such route). Every debt listed
 * pauses paid calls, whatever its state: `OPEN` and `WRITTEN_OFF` need a
 * signature (settling a written-off one still pays the provider), `REPLACING`
 * is signed and being collected, and paid calls resume once it lands. The
 * banner says so in plain words, and "Sign to settle" settles the oldest one
 * the session's wallet still has to sign: the replacement voucher is fetched,
 * checked against the pinned escrow and the debt (`settle-debt.ts`), signed by
 * the payer's wallet, and sent back.
 */
export function BuyerDebtBanner({ wrapperClassName }: { wrapperClassName?: string }) {
  const { ready, authenticated } = usePrivy();
  const [hasStoredToken, setHasStoredToken] = React.useState(false);
  React.useEffect(() => setHasStoredToken(getSessionToken() !== null), []);

  const query = useQuery<BuyerDebts, ApiError>({
    queryKey: BUYER_DEBTS_KEY,
    queryFn: getBuyerDebts,
    enabled: hasBlockStatusSession({ ready, authenticated, hasStoredToken }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 0,
  });

  const account = query.data?.account ?? null;
  const signerState = useSigner({
    chainId: chainIdOfAccount(account),
    address: addressOfAccount(account) || undefined,
  });
  const readOnly = useAccountReadOnly();
  const { nameOf } = useToolNames();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A debt is signable only once its original voucher is past its on-chain
  // deadline (`replaceableAt`). `now` moves on at the earliest such time, and
  // with every new list, so the button turns on without a reload.
  const [tick, setTick] = React.useState(() => Date.now());
  const now = Math.max(tick, query.dataUpdatedAt);
  const wakeAt = nextReplaceableAt(debtsToSign(splitDebts(query.data).own), now);
  React.useEffect(() => {
    if (wakeAt === null) return;
    // setTimeout holds at most ~24.8 days; a longer wait is caught by a refetch.
    const delay = Math.min(Math.max(wakeAt - Date.now(), 0) + 250, 2 ** 31 - 1);
    const timer = setTimeout(() => setTick(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [wakeAt]);

  const { own, others } = splitDebts(query.data);
  const all = [...own, ...others];
  if (all.length === 0) return null;
  const ownToSign = debtsToSign(own);
  // The oldest one that can be signed now; else the oldest, shown disabled.
  const next = ownToSign.find((debt) => isReplaceable(debt, now)) ?? ownToSign[0] ?? null;
  const nextWaiting = next !== null && !isReplaceable(next, now);
  const waiting = ownToSign.filter((debt) => !isReplaceable(debt, now));
  const othersToSign = debtsToSign(others);

  async function onSettle() {
    if (!next || nextWaiting) return;
    if (signerState.status !== "ready") {
      setError(
        signerState.status === "address-not-connected"
          ? `Connect the wallet that holds ${signerState.requested} — it is the wallet that owes this.`
          : signerState.status === "hydrating" || signerState.status === "chain-unknown"
            ? "Still loading your wallet. Try again in a moment."
            : "Connect a wallet to sign this.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await settleDebt(next, signerState.signer, {
        createIntent: createDebtVoucherIntent,
        submit: submitDebtVoucher,
      });
      toast.success(settledToast(result.remainingDebts));
      void queryClient.invalidateQueries({ queryKey: BUYER_DEBTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["escrow"] });
    } catch (e) {
      if (isUserRejection(e)) {
        setError("Nothing was signed — the wallet prompt was closed or declined.");
      } else if (e instanceof ApiError) {
        setError(settleDebtErrorSentence(e) ?? e.message);
        if (
          e.code === "PAYMENT_DEBT_NOT_FOUND" ||
          e.code === "PAYMENT_DEBT_REPLACEMENT_PENDING" ||
          e.code === "PAYMENT_DEBT_NOT_YET_REPLACEABLE" ||
          e.code === "PAYMENT_DEBT_REPLACEMENT_REFUSED"
        ) {
          void queryClient.invalidateQueries({ queryKey: BUYER_DEBTS_KEY });
        }
      } else {
        setError(e instanceof Error ? e.message : "The voucher could not be signed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={wrapperClassName}>
      <div
        role="alert"
        data-testid="buyer-debt-banner"
        className={cn(
          bannerVariants({ tone: "warning" }),
          "flex-col items-start gap-3 tablet:flex-row tablet:items-center",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <p className="text-label-sm text-01">{debtBannerTitle(all)}</p>
          <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{debtBannerDescription(all)}</p>
          {all.length > 1 ? (
            <ul className="mt-1 flex flex-col gap-0.5 font-mono text-mono-12 text-02">
              {all.map((debt) => (
                <li key={debt.intentId} className="[overflow-wrap:anywhere]">
                  {debtRowText(debt, nameOf)}
                </li>
              ))}
            </ul>
          ) : null}
          {othersToSign.length > 0 ? (
            <p className="text-body-13 text-02">
              {othersToSign.length === all.length
                ? othersToSign.length === 1
                  ? "It is"
                  : "These are"
                : `${othersToSign.length} of them ${othersToSign.length === 1 ? "is" : "are"}`}{" "}
              owed by another wallet of your organization: sign in with that wallet to settle{" "}
              {othersToSign.length === 1 ? "it" : "them"}.
            </p>
          ) : null}
          {waiting.length > 0 ? (
            <p data-testid="buyer-debt-not-yet" className="text-body-13 text-02 [overflow-wrap:anywhere]">
              {waiting.length < ownToSign.length
                ? `${waiting.length} of them ${waiting.length === 1 ? "is" : "are"} not ready to sign yet: `
                : ""}
              {notYetReplaceableSentence(
                new Date(nextReplaceableAt(waiting, now)!).toISOString(),
                waiting.length < ownToSign.length ? (waiting.length === 1 ? "it" : "the first") : "this",
              )}
            </p>
          ) : null}
          {error ? (
            <p role="status" className="text-body-13 text-danger-600 [overflow-wrap:anywhere]">
              {error}
            </p>
          ) : null}
        </div>
        {next ? (
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => void onSettle()}
            loading={busy}
            disabled={busy || readOnly || nextWaiting}
          >
            {ownToSign.length > 1 ? `Sign to settle (1 of ${ownToSign.length})` : "Sign to settle"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
