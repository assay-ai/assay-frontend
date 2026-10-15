"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/libs/ApiClient";
import { plainStatus } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getToolCall } from "@/services/tool-calls.service";
import { formatMoney } from "@/utils/money";

import { useToolNames } from "./use-tool-names";

/**
 * A payment link opened from a notification. Approving a payment by hand does
 * not exist yet (no decide endpoint), so this page shows the call's OUTCOME —
 * settled, not charged, or still being checked — with a link to its receipt,
 * never approve/decline buttons that cannot do anything. A call priced above
 * the budget is refused, and the budget is one tap away.
 */
const SETTLED = new Set(["SETTLED", "COMMITTED", "PAID"]);
const NOT_CHARGED = new Set(["REFUNDED", "VOIDED", "EXPIRED", "RELEASED", "FAILED_VERIFICATION"]);

export function outcomeOf(status: string): { chip: StatusChipKey; headline: string } {
  if (SETTLED.has(status)) return { chip: "charged", headline: "Already settled" };
  if (NOT_CHARGED.has(status)) return { chip: "not-charged", headline: "Not charged" };
  return { chip: "checking", headline: "Still in progress" };
}

export function ApprovalLinkView({ approvalId }: { approvalId: string }) {
  const { nameOf } = useToolNames();
  const call = useQuery({
    queryKey: ["tool-call", approvalId],
    retry: false,
    enabled: approvalId !== "",
    queryFn: () => getToolCall(approvalId),
  });

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-4 px-4 py-6">{children}</div>
  );

  if (call.isPending && approvalId !== "") return shell(<PageState kind="loading" rows={2} label="Opening the payment" />);

  if (approvalId === "" || call.isError || !call.data) {
    const notFound = approvalId === "" || (call.error instanceof ApiError && call.error.status === 404);
    return shell(
      <PageState
        kind="empty"
        title={notFound ? "Nothing is waiting here" : "This link could not be opened"}
        description={
          notFound
            ? "This link has no payment on it. Your calls and their receipts are under Activity."
            : "Try again in a moment. Your calls and their receipts are under Activity."
        }
        action={{ label: "Open Activity", href: "/spend/calls" }}
      />,
    );
  }

  const data = call.data;
  const outcome = outcomeOf(data.status);
  const charged = SETTLED.has(data.status);
  return shell(
    <section aria-label="Payment" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label-md text-01">{outcome.headline}</span>
        <StatusChip status={outcome.chip} />
      </div>
      <p className="font-mono text-[28px] font-semibold leading-tight text-01">
        {formatMoney(charged ? data.charged : data.price, { decimals: 2 })}
      </p>
      <p className="text-body-13 text-02">
        {nameOf(data.toolId)} · {plainStatus(data.status)}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild>
          <Link href={routes.receipt(data.intentId)}>See the receipt</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/limits">Budgets</Link>
        </Button>
      </div>
      <p className="text-body-xs text-03">
        Payments can&apos;t be approved by hand yet. A call that costs more than your budget allows is refused, so
        you are never charged above it.
      </p>
    </section>,
  );
}
