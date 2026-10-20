"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { replaceUrlQuery } from "@/features/operator/url-params";
import { ApprovalItem, ApprovedChainBlockAction, RowSection, type ApprovalResult } from "@/features/operator/approval-item";
import { ResultCard } from "@/features/operator/result-card";
import { approvalErrorMessage } from "@/features/operator/approvals";
import { allWaitingLabel, groupApprovals } from "@/features/operator/inbox";
import { capabilitiesFor } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { useApprovalContext } from "@/features/operator/use-approval-context";
import type { OperatorApprovalStatus } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { listApprovals } from "@/services/operator.service";
import { cn } from "@/utils";
import { operatorQueries } from "@/features/operator/queries";

/**
 * Approvals, route `/operator/approvals` (reached from Home).
 *
 * Three groups, so nobody has to work out which requests are theirs:
 *  - **Waiting for you**: someone else asked, and your roles can
 *    decide it. Home's "Needs you" adds the disputes to rule; this page is
 *    approvals only, so it is labelled differently rather than counted
 *    differently under the same name.
 *  - **Your requests**: who can approve each one, and a link to send them.
 *  - **Others**: waiting for a role you do not hold; collapsed.
 *
 * Each is one bordered list of rows (the same row as Home); a row's chevron
 * opens the request's fields.
 *
 * `?id=` opens on one request (the link an approver is sent); `?tab=history`
 * shows decided ones, with "withdrawn" for a request its requester took back.
 */

type Tab = "waiting" | "history";
type HistoryFilter = "" | Exclude<OperatorApprovalStatus, "PENDING">;

const HISTORY_PAGE = 50;

function ApprovalsInbox() {
  const me = useOperatorSession();
  const canRule = capabilitiesFor(me.roles).rule;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const highlight = searchParams.get("id");
  const tab: Tab = searchParams.get("tab") === "history" ? "history" : "waiting";
  const [historyFilter, setHistoryFilter] = React.useState<HistoryFilter>("");

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "history") params.set("tab", "history");
    else params.delete("tab");
    params.delete("id");
    const query = params.toString();
    replaceUrlQuery(pathname, query);
  };

  // Same key as the shell's badge and Home.
  const pending = useQuery({
    ...operatorQueries.pendingApprovals(),
    refetchInterval: 30_000,
    retry: 0,
  });
  const history = useInfiniteQuery({
    queryKey: ["operator", "approvals", "history", historyFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listApprovals({ status: historyFilter || undefined, cursor: pageParam, limit: HISTORY_PAGE }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    enabled: tab === "history",
    retry: 0,
  });

  const groups = React.useMemo(() => groupApprovals(pending.data?.items ?? [], me), [pending.data, me]);
  const historyRows = React.useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page.items).filter((row) => row.status !== "PENDING"),
    [history.data],
  );
  const shown = tab === "waiting" ? [...groups.needsYou, ...groups.yours, ...groups.others] : historyRows;
  const { context, approversFor, nameOf } = useApprovalContext(shown, me);

  const highlightedInOthers = highlight !== null && groups.others.some((row) => row.id === highlight);
  const [othersOpen, setOthersOpen] = React.useState(false);
  React.useEffect(() => {
    if (highlightedInOthers) setOthersOpen(true);
  }, [highlightedInOthers]);
  // A shared link lands on its request.
  // Once per link, not on every 30-second refresh.
  const scrolledTo = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!highlight || !pending.data || scrolledTo.current === highlight) return;
    const element = document.getElementById(`approval-${highlight}`);
    if (!element) return;
    scrolledTo.current = highlight;
    element.scrollIntoView({ block: "center" });
    element.focus();
  }, [highlight, pending.data, othersOpen]);
  const highlightGone =
    tab === "waiting" && highlight !== null && pending.data !== undefined && !pending.data.items.some((row) => row.id === highlight);

  const [results, setResults] = React.useState<ApprovalResult[]>([]);
  const onDecided = React.useCallback((result: ApprovalResult) => setResults((list) => [result, ...list.filter((r) => r.id !== result.id)]), []);

  const waitingCount = groups.needsYou.length + groups.yours.length + groups.others.length;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="touch-target self-start">
        <Link href="/operator">
          <ArrowLeft aria-hidden="true" />
          Home
        </Link>
      </Button>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Approvals</h1>
        <p className="text-body-13 text-03">Actions that need two people. Each request expires 24 h after it was asked.</p>
      </header>

      <div role="group" aria-label="Approvals" className="flex w-full gap-4 border-b border-01">
        {(
          [
            ["waiting", allWaitingLabel(waitingCount)],
            ["history", "History"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "touch-target -mb-px inline-flex items-end border-b-2 pb-2 text-label-13",
              tab === value ? "border-primary-500 text-01" : "border-transparent text-02 hover:text-01",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "waiting" ? (
        pending.isLoading ? (
          <PageState kind="loading" rows={3} label="Loading approvals" />
        ) : pending.isError ? (
          <PageState
            kind="error"
            description={approvalErrorMessage(pending.error, "list")}
            onRetry={() => void pending.refetch()}
            code={pending.error instanceof ApiError ? pending.error.code : null}
          />
        ) : (
          <>
            {results.map((result) => (
              <React.Fragment key={result.id}>
                <ResultCard
                  title={result.title}
                  next={result.next}
                  activityHref={result.activityHref}
                  onDismiss={() => setResults((list) => list.filter((r) => r.id !== result.id))}
                />
                {/* A-11: the approval's result is the arbiter's unsigned setBlocked; its wallet signs here. */}
                {result.chainBlock ? <ApprovedChainBlockAction block={result.chainBlock} /> : null}
              </React.Fragment>
            ))}

            {highlightGone && !results.some((r) => r.id === highlight) ? (
              <p role="status" className="w-full rounded-lg border border-01 bg-01 px-3.5 py-2.5 text-body-13 text-02">
                The request you opened is no longer waiting: it was decided, withdrawn or has expired.{" "}
                <button type="button" onClick={() => setTab("history")} className="hit-area text-primary-600 hover:underline">
                  See History
                </button>
              </p>
            ) : null}

            {waitingCount === 0 ? (
              <PageState
                kind="empty"
                title="Nothing waiting"
                description={`No two-person request is open right now.${canRule ? " Disputes to rule are on Home and Arbiter, not here." : ""}`}
              />
            ) : null}

            {groups.needsYou.length > 0 ? (
              <RowSection id="needs-you" title="Waiting for you" count={groups.needsYou.length}>
                {groups.needsYou.map((row) => (
                  <ApprovalItem
                    key={row.id}
                    approval={row}
                    context={context}
                    mode="decide"
                    onDecided={onDecided}
                    approvers={approversFor(row)}
                    nameOf={nameOf}
                    highlighted={row.id === highlight}
                  />
                ))}
              </RowSection>
            ) : null}

            {groups.yours.length > 0 ? (
              <RowSection id="yours" title="Your requests" count={groups.yours.length} hint="Send the link to someone who can approve.">
                {groups.yours.map((row) => (
                  <ApprovalItem
                    key={row.id}
                    approval={row}
                    context={context}
                    mode="own"
                    onDecided={onDecided}
                    approvers={approversFor(row)}
                    nameOf={nameOf}
                    highlighted={row.id === highlight}
                  />
                ))}
              </RowSection>
            ) : null}

            {groups.others.length > 0 ? (
              <section aria-labelledby="others" className="flex w-full min-w-0 flex-col gap-2">
                <button
                  type="button"
                  id="others"
                  aria-expanded={othersOpen}
                  onClick={() => setOthersOpen((open) => !open)}
                  className="touch-target inline-flex items-center gap-1 self-start rounded-md text-label-13 text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", othersOpen && "rotate-90")} />
                  Others<span className="tabular-nums text-03"> · {groups.others.length}</span>
                  <span className="font-normal text-03"> · waiting for a role you do not hold</span>
                </button>
                {othersOpen ? (
                  <div className="flex w-full min-w-0 flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
                    {groups.others.map((row) => (
                      <ApprovalItem
                        key={row.id}
                        approval={row}
                        context={context}
                        mode="other"
                        approvers={approversFor(row)}
                        nameOf={nameOf}
                        highlighted={row.id === highlight}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )
      ) : (
        <>
          <Segmented value={historyFilter} onValueChange={(value) => setHistoryFilter(value as HistoryFilter)} aria-label="Outcome" className="self-start">
            <SegmentedItem value="">All</SegmentedItem>
            <SegmentedItem value="APPROVED">Approved</SegmentedItem>
            <SegmentedItem value="REJECTED">Rejected or withdrawn</SegmentedItem>
            <SegmentedItem value="EXPIRED">Expired</SegmentedItem>
          </Segmented>
          {history.isLoading ? (
            <PageState kind="loading" rows={3} label="Loading history" />
          ) : history.isError ? (
            <PageState
              kind="error"
              description={approvalErrorMessage(history.error, "list")}
              onRetry={() => void history.refetch()}
              code={history.error instanceof ApiError ? history.error.code : null}
            />
          ) : historyRows.length === 0 ? (
            <PageState kind="empty" title="No history" description="No request has been decided with this outcome yet." />
          ) : (
            <div className="flex w-full min-w-0 flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
              {historyRows.map((row) => (
                <ApprovalItem key={row.id} approval={row} context={context} mode="history" nameOf={nameOf} />
              ))}
            </div>
          )}
          {history.hasNextPage ? (
            <Button variant="secondary" className="self-start" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
              Load more
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}

export default function ApprovalsPage() {
  // `useSearchParams()` needs a Suspense boundary to build.
  return (
    <React.Suspense fallback={null}>
      <ApprovalsInbox />
    </React.Suspense>
  );
}
