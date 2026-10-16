"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { ApprovalCard } from "@/components/ui/approval-card";
import { EmptyState } from "@/components/ui/empty-state";
import { chainBalances } from "@/features/g30/balance";
import { spentFromTotals } from "@/features/g30/spend-buckets";
import type { Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { getBalances } from "@/services/balances.service";
import { getSpendPolicyTyped } from "@/services/limits.service";
import { getReceiptsSummary } from "@/services/receipts.service";
import { getToolCall } from "@/services/tool-calls.service";
import { formatMoney } from "@/utils/money";

import { StatusPill } from "./chrome";
import { formatLimit, subtractMoney, todayBounds } from "./format";
import { useToolNames } from "./use-tool-names";

/**
 * Approval link (designed at mobile width 390).
 *
 * Mobile-first by definition: this is a signed one-shot link somebody opens
 * on a phone, away from the dashboard, so the layout is a single 390-wide
 * column that merely stops growing on a larger screen rather than rearranging
 * into one.
 *
 * The card itself is the design system's `ApprovalCard`,
 * whose whole point is that it always offers two distinct outcomes — approve,
 * in either of its two forms, and decline — and never a single
 * acknowledgement control. An approval that auto-approves is not an approval.
 *
 * What is real: the amount, the tool, the provider and the timestamp come
 * from `GET /tool-calls/{intentId}`; "Spent today" from
 * `GET /receipts/summary` over the UTC day (charged plus owed); "Balance after" from
 * `GET /balances` minus the listed price; the scoped-approval ceiling from
 * `dailyCap` on `GET /spend-policy`.
 *
 * What is not: **there is no decide endpoint.** Nothing in the API accepts an
 * approve or a decline, so all three controls are disabled and the reason is
 * on screen. A button that looks live and silently drops the decision would
 * be the worst possible failure on this particular screen — the call would
 * expire and the agent would be told nobody answered.
 */

interface SummaryTotals {
  chargedTotal?: Money;
  owedTotal?: Money;
}

export function ApprovalLinkView({ approvalId }: { approvalId: string }) {
  const day = React.useMemo(() => todayBounds(), []);
  const { nameOf } = useToolNames();

  const call = useQuery({
    queryKey: ["tool-call", approvalId],
    retry: false,
    queryFn: () => getToolCall(approvalId),
  });

  const balances = useQuery({ queryKey: ["balances"], queryFn: getBalances });
  const todaySpend = useQuery({
    queryKey: ["receipts-summary", "day", day.from],
    queryFn: () => getReceiptsSummary({ from: day.from, to: day.to, groupBy: "tool" }),
  });
  const policy = useQuery({
    queryKey: ["spend-policy"],
    retry: false,
    queryFn: async () => {
      try {
        return await getSpendPolicyTyped();
      } catch (error) {
        if (error instanceof ApiError && error.code === "SPEND_POLICY_NOT_FOUND") return null;
        throw error;
      }
    },
  });

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-[390px] flex-1 flex-col">
      <div className="flex w-full items-center gap-2.5 border-b border-01 bg-01 px-4 py-3.5">
        <img src="/images/logo.png" alt="" aria-hidden="true" className="h-5 w-5 shrink-0 rounded-md object-cover" />
        <span className="text-[17px] font-medium leading-none tracking-[-0.025em] text-01">Assay</span>
        <StatusPill label="ONE-TIME LINK" tone="success" />
      </div>
      <div className="flex w-full flex-1 flex-col px-4 pt-4">{children}</div>
      <div className="flex w-full flex-col gap-1 px-4 pb-[22px] pt-3.5">
        <p className="text-body-xs text-03">
          Opened twice? The second open shows the outcome, never a second charge.
        </p>
      </div>
    </div>
  );

  if (call.isPending) {
    return shell(<p className="font-mono text-mono-13 text-03">Loading…</p>);
  }

  if (call.isError || !call.data) {
    const notFound = call.error instanceof ApiError && call.error.status === 404;
    return shell(
      <EmptyState
        className="max-w-full"
        title={notFound ? "This link has no decision on it" : "This link could not be opened"}
        description={
          notFound
            ? "Nothing is waiting under this id. A one-time link that has already been used shows its outcome instead; one that never existed shows this."
            : call.error instanceof ApiError
              ? call.error.message
              : "The request could not be completed."
        }
      />
    );
  }

  const price = call.data.price;
  const rows = chainBalances(balances.data?.balances);
  /*
    An approval is scoped to a chain the moment money moves on it, and this
    view does not yet know which — the router picks per call and nothing
    on this screen carries the answer. So it shows a figure only when there is
    exactly one row: no silent pick, and the same rule as auto-top-up for the
    same reason.

    Was `balances[0]?.available`, which subtracted an eip155 price from a
    Solana balance and printed "balance after" as if that were a fact.
  */
  const available = rows.length === 1 ? rows[0].available : null;
  const balanceAfter = available ? subtractMoney(available, price) : null;

  // Charged plus owed: an open or written-off debt is spend the buyer owes.
  const chargedToday = spentFromTotals(
    (todaySpend.data as { totals?: SummaryTotals } | undefined)?.totals,
  );
  const dailyCap = policy.data?.dailyCap ?? null;

  const spentToday = chargedToday
    ? dailyCap
      ? `${formatMoney(chargedToday, { decimals: 2 })} of ${formatLimit(dailyCap)}`
      : formatMoney(chargedToday, { decimals: 2 })
    : "—";

  return shell(
    <div className="flex w-full flex-col gap-3">
      <ApprovalCard
        amount={formatMoney(price, { decimals: 2 })}
        toolName={nameOf(call.data.toolId)}
        context={`${call.data.providerId ?? "no provider yet"} · ${call.data.status}`}
        requestPayload={JSON.stringify(
          { intentId: call.data.intentId, toolId: call.data.toolId },
          null,
          2
        )}
        spentToday={spentToday}
        sessionSpend={formatMoney(price, { decimals: 2 })}
        balanceAfter={balanceAfter ? formatMoney(balanceAfter, { decimals: 2 }) : "—"}
        scopedLimit={dailyCap ? formatLimit(dailyCap) : "the daily cap"}
        expiryLabel={`Call recorded ${new Date(call.data.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC`}
        disabled
      />
      <p className="text-body-xs text-03">
        Approving or declining a call is not available yet, so these buttons are disabled.
      </p>
    </div>
  );
}
