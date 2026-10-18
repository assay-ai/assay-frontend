"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { bySlaUrgency, disputeQueueQuery, slaMarks } from "@/features/call-disputes/model";
import { useNow } from "@/features/call-disputes/ui";
import { mayDecideCallDisputes } from "@/features/operator/provider-tool-review";
import { OperatorCasesTabs } from "@/features/operator/provider-tool-ui";
import { useOperatorSession } from "@/features/operator/session-context";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listOperatorCallDisputes } from "@/services/operator-call-disputes.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * Call disputes — `/operator/disputes`: buyers' reports of bad results over
 * paid calls (G3.B1), oldest first because the SLA runs from the filing: the
 * provider has 24 hours to reply, an operator is paged at 48, and at 72 a
 * silent provider is upheld automatically (a provider that replied stays
 * held and pages instead).
 */

const MARK_TONE = { neutral: "neutral", warning: "warning", danger: "danger" } as const;

function DisputesScreen() {
  const me = useOperatorSession();
  const now = useNow(30_000);
  const [show, setShow] = React.useState<"open" | "all">("open");
  const [flagged, setFlagged] = React.useState(false);
  // Open: oldest first from the server, so the disputes closest to auto-uphold always load first.
  const list = useInfiniteQuery({
    queryKey: ["operator", "call-disputes", "queue", show, flagged],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listOperatorCallDisputes(disputeQueueQuery(show, flagged, pageParam)),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    retry: 0,
    refetchInterval: 60_000,
  });
  const items = React.useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data]);
  const rows = show === "open" ? bySlaUrgency(items) : items;
  return (
    <>
      <OperatorCasesTabs />
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Call disputes</h1>
          <p className="text-body-13 text-02">Buyers&apos; reports of bad results on paid calls. Decide within 72 hours of the filing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={show} onValueChange={(v) => setShow(v as "open" | "all")} aria-label="Show" className="inline-flex rounded-md bg-03 p-0.5">
            <SegmentedItem value="open">Open</SegmentedItem>
            <SegmentedItem value="all">All</SegmentedItem>
          </Segmented>
          <button
            type="button"
            aria-pressed={flagged}
            onClick={() => setFlagged((on) => !on)}
            className={cn("min-h-10 rounded-full border px-3 text-label-13", flagged ? "border-primary-500 bg-primary-10 text-primary-700" : "border-02 bg-01 text-02 hover:text-01")}
          >
            Mostly-rejected buyers
          </button>
        </div>
      </header>
      {!mayDecideCallDisputes(me.roles) ? <p className="text-body-13 text-03">You can read disputes. Deciding needs an Adjudicator or a Lead adjudicator.</p> : null}
      {list.isPending ? (
        <PageState kind="loading" rows={4} label="Loading disputes" />
      ) : list.isError ? (
        <PageState kind="error" description="The disputes could not be loaded." onRetry={() => void list.refetch()} code={list.error instanceof ApiError ? list.error.code : null} />
      ) : rows.length === 0 ? (
        <PageState kind="empty" title={show === "open" ? "No open disputes" : "No disputes"} description="Buyers report bad results from a call's receipt." />
      ) : (
        <ul className="flex w-full flex-col divide-y divide-01 rounded-xl border border-01 bg-01" data-testid="dispute-queue">
          {rows.map((d) => (
            <li key={d.id}>
              <Link href={routes.operatorCallDispute(d.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-label-13 text-01">
                    {d.reasonLabel}
                    {d.amount ? <span className="font-mono text-mono-12 text-02"> · {formatMoney(d.amount, { decimals: 4 })}</span> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-body-xs text-03">
                    <span>
                      Filed <UtcTime value={d.createdAt} relative midSentence />
                    </span>
                    {d.state !== "OPEN" ? <Chip>{d.state === "UPHELD" ? "Upheld" : d.state === "REJECTED" ? "Rejected" : "Withdrawn"}</Chip> : null}
                    {slaMarks(d, now).map((mark) => (
                      <Chip key={mark.label} tone={MARK_TONE[mark.tone]}>
                        {mark.label}
                      </Chip>
                    ))}
                    {d.providerRespondedAt ? <Chip>Provider replied</Chip> : null}
                    {d.refundState === "REFUNDED" && d.state === "OPEN" ? <Chip tone="success">Refunded: provider blocked</Chip> : null}
                    {d.buyerHistory.flagged ? <Chip tone="warning">Buyer mostly rejected</Chip> : null}
                    {d.needsSecondOperator ? <Chip tone="primary">Upholding needs two</Chip> : null}
                    {d.refundGuaranteed ? null : <Chip>After the hold</Chip>}
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-03" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Show more
        </Button>
      ) : null}
    </>
  );
}

export default function OperatorDisputesPage() {
  return (
    <React.Suspense fallback={null}>
      <DisputesScreen />
    </React.Suspense>
  );
}
