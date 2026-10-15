"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { ApprovalItem } from "@/features/operator/approval-item";
import { approvalErrorMessage } from "@/features/operator/approvals";
import { groupApprovals } from "@/features/operator/inbox";
import { useOperatorSession } from "@/features/operator/session-context";
import { useApprovalContext } from "@/features/operator/use-approval-context";
import type { OperatorApprovalStatus } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { listApprovals } from "@/services/operator.service";
import { cn } from "@/utils";

/**
 * Approvals, route `/operator/approvals` (reached from Home).
 *
 * Three groups, so nobody has to work out which requests are theirs:
 *  - **Needs you**: someone else asked, and your roles can decide it. The
 *    shell's badge counts these and only these.
 *  - **Your requests**: who can approve each one, and a link to send them.
 *  - **Others**: waiting for a role you do not hold; collapsed.
 *
 * `?id=` opens on one request (the link an approver is sent); `?tab=history`
 * shows decided ones, with "withdrawn" for a request its requester took back.
 */

type Tab = "waiting" | "history";
type HistoryFilter = "" | Exclude<OperatorApprovalStatus, "PENDING">;

const PENDING_PAGE = 100;
const HISTORY_PAGE = 50;

function ApprovalsInbox() {
  const me = useOperatorSession();
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
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // Same key as the shell's badge and Home.
  const pending = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: PENDING_PAGE }),
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
  React.useEffect(() => {
    if (!highlight || !pending.data) return;
    const element = document.getElementById(`approval-${highlight}`);
    element?.scrollIntoView({ block: "center" });
    element?.focus();
  }, [highlight, pending.data, othersOpen]);
  const highlightGone =
    tab === "waiting" && highlight !== null && pending.data !== undefined && !pending.data.items.some((row) => row.id === highlight);

  const waitingCount = groups.needsYou.length + groups.yours.length + groups.others.length;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link href="/operator">
          <ArrowLeft aria-hidden="true" />
          Home
        </Link>
      </Button>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Approvals</h1>
        <p className="text-body-13 text-03">Actions that need two people. Each request expires 24 h after it was asked.</p>
      </header>

      <div role="tablist" aria-label="Approvals" className="flex w-full gap-4 border-b border-01">
        {(
          [
            ["waiting", `Waiting${waitingCount > 0 ? ` · ${waitingCount}` : ""}`],
            ["history", "History"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "-mb-px border-b-2 pb-2 text-label-13",
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
            {highlightGone ? (
              <p role="status" className="w-full rounded-lg border border-01 bg-01 px-3.5 py-2.5 text-body-13 text-02">
                The request you opened is no longer waiting: it was decided, withdrawn or has expired.{" "}
                <button type="button" onClick={() => setTab("history")} className="text-primary-600 hover:underline">
                  See History
                </button>
              </p>
            ) : null}

            {waitingCount === 0 ? (
              <PageState kind="empty" title="Nothing waiting" description="No two-person request is open right now." />
            ) : null}

            {groups.needsYou.length > 0 ? (
              <Group id="needs-you" title={`Needs you · ${groups.needsYou.length}`}>
                {groups.needsYou.map((row) => (
                  <ApprovalItem
                    key={row.id}
                    approval={row}
                    context={context}
                    mode="decide"
                    approvers={approversFor(row)}
                    nameOf={nameOf}
                    highlighted={row.id === highlight}
                  />
                ))}
              </Group>
            ) : null}

            {groups.yours.length > 0 ? (
              <Group id="yours" title={`Your requests · ${groups.yours.length}`} note="Send the link to someone who can approve.">
                {groups.yours.map((row) => (
                  <ApprovalItem
                    key={row.id}
                    approval={row}
                    context={context}
                    mode="own"
                    approvers={approversFor(row)}
                    nameOf={nameOf}
                    highlighted={row.id === highlight}
                  />
                ))}
              </Group>
            ) : null}

            {groups.others.length > 0 ? (
              <details
                open={othersOpen}
                onToggle={(event) => setOthersOpen((event.currentTarget as HTMLDetailsElement).open)}
                className="flex w-full flex-col"
              >
                <summary className="cursor-pointer select-none text-label-md text-02 hover:text-01">
                  Others · {groups.others.length} <span className="text-body-13 text-03">waiting for a role you do not hold</span>
                </summary>
                <div className="mt-2.5 flex w-full flex-col gap-2.5">
                  {groups.others.map((row) => (
                    <ApprovalItem
                      key={row.id}
                      approval={row}
                      context={context}
                      mode="other"
                      approvers={approversFor(row)}
                      nameOf={nameOf}
                      highlighted={row.id === highlight}
                      compact
                    />
                  ))}
                </div>
              </details>
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
            <div className="flex w-full flex-col gap-2.5">
              {historyRows.map((row) => (
                <ApprovalItem key={row.id} approval={row} context={context} mode="history" nameOf={nameOf} compact />
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

function Group({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex w-full flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-label-md text-01">
          {title}
        </h2>
        {note ? <p className="text-body-xs text-03">{note}</p> : null}
      </div>
      {children}
    </section>
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
