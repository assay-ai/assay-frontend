"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { SetupChecklist, type SetupStep } from "@/components/patterns/setup-checklist";
import { Button } from "@/components/ui/button";
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
 *  3. Close — not possible in the app yet (no endpoint), said in one line,
 *     with a support link only when this deployment has one.
 */

interface Hold {
  amount?: Money;
  status?: string;
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
                    {line.complete ? formatMoney(line.amount) : `at least ${formatMoney(line.amount)}`}
                  </span>
                  <span className="text-body-xs text-03">
                    on {chainName(line.chainId)}
                    {line.accounts > 1 ? ` · across ${line.accounts} accounts` : ""}
                  </span>
                </div>
                <Button size="sm" asChild>
                  <Link href="/funding?action=withdraw">Withdraw</Link>
                </Button>
              </li>
            ))}
          </ul>
          {openHolds.length > 0 ? (
            <p className="text-body-xs text-03">
              {openHolds.length} {openHolds.length === 1 ? "call is" : "calls are"} still being checked. Their held
              money is charged or comes back within 24 hours; then withdraw it too.
            </p>
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
      id: "close",
      title: "Close the account",
      state: "blocked",
      blockedReason: SUPPORT_URL ? (
        <>
          Closing an account is not available in the app yet.{" "}
          <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 underline">
            Ask support to close it <ArrowRight aria-hidden="true" className="size-3" />
          </a>
        </>
      ) : (
        "Closing an account is not available in the app yet. Your account stays open and costs nothing while it holds no money."
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
