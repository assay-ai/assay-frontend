"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useAgentsAndKeys } from "@/components/buyer-money/use-agents";
import { checklistProgress, SetupChecklist, type SetupStep } from "@/components/patterns/setup-checklist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { closeAccountHeldText } from "@/features/buyer-debt/debt-copy";
import { useSettleDebt } from "@/features/buyer-debt/settle-debt-sheet";
import { useOwedIntentIds } from "@/features/buyer-debt/use-owed-intent-ids";
import { isLiveKey, nothingToWithdraw, readyToClose, withdrawableByAsset } from "@/features/buyer/close-account";
import { chainBalances, type FullBalance } from "@/features/g30/balance";
import { useChainName } from "@/hooks/useChainName";
import type { Money } from "@/interfaces";
import { routes } from "@/libs/routes";
import { SUPPORT_URL } from "@/libs/support";
import { getBalances, getHolds } from "@/services/balances.service";
import { formatMoney } from "@/utils/money";

import { PageHeader } from "./chrome";

/**
 * Account › Close account, as a 3-step checklist:
 *  1. Withdraw your money — the withdrawable total per asset (accounts on one
 *     chain merged; different assets never added), each with Withdraw; ticks
 *     from the balances;
 *  2. Export your records — Statement CSV, Calls, Account history; saving a
 *     file happens outside the app, so the person ticks it;
 *  3. Revoke your agent keys — ticks from the keys: none still works.
 * Closing itself has no endpoint, so below the steps "Ask us to close the
 * account" opens the support link, enabled at 3 of 3 (when this deployment
 * has one; without it the page says so instead of a button to nowhere).
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

  const [recordsKept, setRecordsKept] = React.useState(false);
  const { agentsQuery, keysQuery } = useAgentsAndKeys();
  const keysUnreadable = agentsQuery.isError || keysQuery.isError;
  // Null while unknown. No agents at all means no key, so it is known at once.
  const liveKeys: number | null =
    agentsQuery.isSuccess && (agentsQuery.data?.items ?? []).length === 0
      ? 0
      : keysQuery.isSuccess
        ? Object.values(keysQuery.data ?? {}).flat().filter((key) => isLiveKey(key)).length
        : null;

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
      state: recordsKept ? "done" : withdrawn ? "current" : "todo",
      description: "Keep your statements and call history; they are not available once the account is closed.",
      content: (
        <div className="flex flex-col gap-2.5">
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
              <Link href="/audit-log">Account history</Link>
            </Button>
          </div>
          {/* Saving a file happens outside the app, so only the person can say it is done. */}
          <Checkbox
            checked={recordsKept}
            onChange={(event) => setRecordsKept(event.target.checked)}
            label="I have saved the records I need"
          />
        </div>
      ),
    },
    {
      // Ticks from data: no key of any agent can still make a call.
      id: "keys",
      title: "Revoke your agent keys",
      state: liveKeys === 0 ? "done" : recordsKept ? "current" : "todo",
      description:
        liveKeys === null
          ? keysUnreadable
            ? "Your agent keys could not be read, so we cannot say whether one still works. Try again in a moment."
            : "Checking your agent keys…"
          : liveKeys === 0
            ? "No agent key works any more, so nothing can spend from this account."
            : `${liveKeys} agent key${liveKeys === 1 ? " still works" : "s still work"}. Revoke ${liveKeys === 1 ? "it" : "them"} so nothing can spend in the meantime.`,
      content:
        liveKeys === 0 ? undefined : (
          <Button size="sm" asChild>
            <Link href="/agents">Revoke agent keys</Link>
          </Button>
        ),
    },
  ];
  const progress = checklistProgress(steps);
  const ready = readyToClose({ withdrawn, recordsKept, liveKeys });

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Close account" />
      <SetupChecklist
        title="Before you close"
        description="Three steps. Each ticks itself off when it is done."
        steps={steps}
        doneTitle="Ready to close"
        doneDescription="Your money is withdrawn, your records are saved and no agent key works."
      />
      {/*
        Closing has no endpoint: the Assay team does it. The request is the
        last step, offered once the three above are done (3 of 3), and only
        when this deployment has somewhere to send it.
      */}
      <section
        aria-label="Close the account"
        className="flex w-full flex-col gap-2.5 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5"
      >
        <h2 className="text-label-md text-01">Close the account</h2>
        {SUPPORT_URL ? (
          <>
            <p className="text-body-13 text-02">
              Closing is done by the Assay team. Send the request once the three steps are done.
            </p>
            {ready ? (
              <Button size="sm" className="self-start" asChild>
                <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
                  Ask us to close the account <ArrowRight aria-hidden="true" className="size-3.5" />
                </a>
              </Button>
            ) : (
              <Button size="sm" type="button" className="self-start" disabled>
                Ask us to close the account
              </Button>
            )}
            {ready ? null : (
              <p className="text-body-xs text-03" data-testid="close-not-ready">
                {progress.done} of {progress.total} steps done. The request opens at {progress.total} of {progress.total}.
              </p>
            )}
          </>
        ) : (
          <p className="text-body-13 text-02">
            Closing is done by the Assay team, not in the app. With no money and no working keys the account cannot spend
            and costs nothing, and you can sign in again any time.
          </p>
        )}
      </section>
    </div>
  );
}
