"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { SetupChecklist, type SetupStep } from "@/components/patterns/setup-checklist";
import { Button } from "@/components/ui/button";
import { closeAccountHeldText } from "@/features/buyer-debt/debt-copy";
import { useSettleDebt } from "@/features/buyer-debt/settle-debt-sheet";
import { useOwedIntentIds } from "@/features/buyer-debt/use-owed-intent-ids";
import { nothingToWithdraw, withdrawableByAsset } from "@/features/buyer/close-account";
import { chainBalances, type FullBalance } from "@/features/g30/balance";
import { useChainName } from "@/hooks/useChainName";
import type { Money } from "@/interfaces";
import { routes } from "@/libs/routes";
import { SUPPORT_URL } from "@/libs/support";
import { getBalances, getHolds } from "@/services/balances.service";
import { formatMoney } from "@/utils/money";

import { PageHeader } from "./chrome";

/**
 * Account › Close account, as a 3-step checklist that ticks from data:
 *  1. Withdraw your money — the withdrawable total per asset (accounts on one
 *     chain merged; different assets never added), each with Withdraw;
 *  2. Export your records — Statement CSV, Calls, Activity log;
 *  3. Close — not possible in the app (no endpoint), so the step ends on
 *     what can be done: revoke agent keys, and ask support when this
 *     deployment has a support link.
 */

interface Hold {
  amount?: Money;
  status?: string;
  intentId?: string;
}

export function CloseAccountView() {
  const chainName = useChainName();
  const balances = useQuery({
    queryKey: ["balances"],
    retry: false,
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
  });
  const holds = useQuery({
    queryKey: ["holds"],
    retry: false,
    queryFn: () => getHolds() as Promise<{ items?: Hold[] } | Hold[]>,
  });

  const openHolds = React.useMemo(() => {
    const data = holds.data;
    const items = !data ? [] : Array.isArray(data) ? data : (data.items ?? []);
    return items.filter((h) => !h.status || h.status === "OPEN");
  }, [holds.data]);

  // An unpaid call's price stays held until it is collected: it does not come back within 24 hours.
  const owedIntentIds = useOwedIntentIds();
  const { openSettle } = useSettleDebt();
  const heldText = closeAccountHeldText(
    openHolds.map((hold) => hold.intentId ?? ""),
    owedIntentIds,
  );

  const rows = chainBalances(balances.data?.balances);
  const lines = withdrawableByAsset(rows);
  const readable = balances.isSuccess;
  const withdrawn = readable && nothingToWithdraw(lines) && openHolds.length === 0;

  const steps: SetupStep[] = [
    {
      id: "withdraw",
      title: "Withdraw your money",
      state: withdrawn ? "done" : "current",
      description: !readable
        ? balances.isError
          ? "Your balance could not be read, so we cannot say what is left. Try again in a moment."
          : "Checking your balance…"
        : withdrawn
          ? "Nothing is left to withdraw."
          : "Move everything you hold back to your wallet.",
      content: readable && !withdrawn ? (
        <div className="flex flex-col gap-2.5">
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.asset} className="flex flex-wrap items-center gap-3 rounded-lg border border-01 bg-02 px-3.5 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-mono-md font-semibold text-01">
                    {line.complete
                      ? formatMoney(line.amount)
                      : BigInt(line.amount.amount) === 0n
                        ? "Unknown"
                        : `at least ${formatMoney(line.amount)}`}
                  </span>
                  <span className="text-body-xs text-03">
                    on {chainName(line.chainId)}
                    {line.accounts > 1 ? ` · across ${line.accounts} accounts` : ""}
                    {line.complete ? "" : " · could not read this chain"}
                  </span>
                </div>
                <Button size="sm" asChild>
                  <Link href="/funding?action=withdraw">Withdraw</Link>
                </Button>
              </li>
            ))}
          </ul>
          {heldText.checking ? (
            <p className="text-body-xs text-03" data-testid="close-held-checking">
              {heldText.checking}
            </p>
          ) : null}
          {heldText.unpaid ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-body-xs text-warning-700" data-testid="close-held-unpaid">
                {heldText.unpaid}
              </p>
              <Button size="sm" variant="secondary" type="button" onClick={() => openSettle()}>
                Settle what is owed
              </Button>
            </div>
          ) : null}
        </div>
      ) : balances.isError ? (
        <Button variant="secondary" size="sm" onClick={() => void balances.refetch()}>
          Try again
        </Button>
      ) : undefined,
    },
    {
      id: "export",
      title: "Export your records",
      state: withdrawn ? "current" : "todo",
      description: "Keep your statements and call history; they are not available once the account is closed.",
      content: (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/statements">Statement CSV</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/spend">Spend CSV</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href={routes.calls()}>Calls</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/audit-log">Activity log</Link>
          </Button>
        </div>
      ),
    },
    {
      // Closing has no endpoint, so this step ends on what a person CAN do:
      // make the account unable to spend, and (when this deployment has one)
      // ask support — never a greyed-out step with nowhere to go.
      id: "close",
      title: SUPPORT_URL ? "Revoke agent keys, then ask us to close it" : "Revoke your agent keys",
      state: withdrawn ? "current" : "todo",
      description: SUPPORT_URL
        ? "Closing is done by the Assay team. Revoke your agent keys so nothing can spend in the meantime, then send the request."
        : "Closing is done by the Assay team, not in the app. Revoke your agent keys: with no money and no keys the account cannot spend and costs nothing, and you can sign in again any time.",
      content: (
        <div className="flex flex-wrap gap-2">
          <Button variant={SUPPORT_URL ? "secondary" : "primary"} size="sm" asChild>
            <Link href="/agents">Revoke agent keys</Link>
          </Button>
          {SUPPORT_URL ? (
            <Button size="sm" asChild>
              <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
                Ask support to close it <ArrowRight aria-hidden="true" className="size-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Close account" />
      <SetupChecklist
        title="Before you close"
        description="Three steps. Each ticks itself off when it is done."
        steps={steps}
      />
    </div>
  );
}
