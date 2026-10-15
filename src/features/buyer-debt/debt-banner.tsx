"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

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
  settledToast,
  splitDebts,
} from "./debt-copy";
import { settleDebt } from "./settle-debt";

export const BUYER_DEBTS_KEY = ["escrow", "debts"] as const;

/**
 * The buyer-debt banner, mounted once in the buyer shell, so it is above the
 * console, the funding and escrow screens and the agents page alike.
 *
 * Reads `GET /escrow/debts`. Nothing shows while there is no open debt, or
 * when the read fails (an older backend has no such route). With a debt open,
 * it says in plain words what happened and what it blocks, and "Sign to
 * settle" settles the oldest one the session's wallet owes: the replacement
 * voucher is fetched, checked against the pinned escrow and the debt
 * (`settle-debt.ts`), signed by the payer's wallet, and sent back.
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
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { own, others } = splitDebts(query.data);
  const all = [...own, ...others];
  if (all.length === 0) return null;
  const next = own[0] ?? null;

  async function onSettle() {
    if (!next) return;
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
        setError(e.message);
        if (e.code === "PAYMENT_DEBT_NOT_FOUND") {
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
                  {debtRowText(debt)}
                </li>
              ))}
            </ul>
          ) : null}
          {others.length > 0 ? (
            <p className="text-body-13 text-02">
              {others.length === all.length ? "These are" : `${others.length} of them ${others.length === 1 ? "is" : "are"}`}{" "}
              owed by another wallet of your organization: sign in with that wallet to settle{" "}
              {others.length === 1 ? "it" : "them"}.
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
            disabled={busy || readOnly}
          >
            {own.length > 1 ? `Sign to settle (1 of ${own.length})` : "Sign to settle"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
