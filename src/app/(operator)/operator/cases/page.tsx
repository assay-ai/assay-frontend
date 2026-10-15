"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Search } from "@/components/ui/search";
import { approvalTargetId } from "@/features/operator/approvals";
import { eligibleApprovers } from "@/features/operator/inbox";
import {
  FALLBACK_TABS,
  OPEN_STATUSES,
  PENALTY_APPROVAL_CODES,
  STATUS_TABS,
  rowFromBrief,
  rowFromCase,
  rowFromDispute,
  rowFromQueue,
  rowMatches,
  tabById,
  tabCounts,
  uniqueRows,
  waitingText,
  type PenaltyRow,
  type PenaltyTab,
  type PenaltyTabId,
} from "@/features/operator/penalty-list";
import { penaltyIdFrom, readRecentPenalties, type RecentPenalty } from "@/features/operator/recent-penalties";
import { useOperatorDirectory, usePenaltyBriefs, useProviderNames } from "@/features/operator/use-operator-lookups";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import {
  listAdjudicationQueue,
  listApprovals,
  listArbiterDisputes,
  listOperatorCases,
  listOverrideLog,
} from "@/services/operator.service";
import { cn } from "@/utils";

import { PenaltyTable } from "./_components/penalty-table";

/**
 * Penalties, route `/operator/cases`.
 *
 * A table of every penalty by where it stands, read from `GET
 * /operator/cases`. One search box: a pasted id or link opens that penalty,
 * typed text filters by provider (and asks the server for that provider when
 * the name is unambiguous). Row click opens the penalty; nothing is done from
 * the list — ruling lives on the penalty page and the Arbiter.
 *
 * A backend older than the list answers 404, and the page then builds its
 * tabs from the lists that do exist (disputed on chain, acted on in Activity,
 * opened here), showing only those.
 */

/** Activity entries read for penalties acted on; their penalties are read whole to name them. */
const ACTIVITY_LOOKBACK = 50;
const PAGE_SIZE = 50;

export default function PenaltiesPage() {
  const router = useRouter();
  const providers = useProviderNames();
  const directory = useOperatorDirectory();
  const tabParam = useSearchParam("tab");
  const [tabId, setTabId] = React.useState<PenaltyTabId | null>(null);
  const queryParam = useSearchParam("q");
  const [query, setQuery] = React.useState("");
  // A link from a penalty's "Provider" fact arrives with the name to search for.
  React.useEffect(() => {
    if (queryParam) setQuery(queryParam);
  }, [queryParam]);
  const [queryError, setQueryError] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<RecentPenalty[]>([]);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  React.useEffect(() => setRecent(readRecentPenalties()), []);

  // A name that matches exactly one provider becomes a server-side filter, so it reaches every page.
  const q = query.trim();
  const named = q && !penaltyIdFrom(q) ? providers.providers.filter((p) => p.legalName.toLowerCase().includes(q.toLowerCase())) : [];
  const providerId = named.length === 1 ? named[0]!.providerId : undefined;

  const open = useQuery({
    queryKey: ["operator", "cases", "open", providerId ?? null],
    queryFn: () => listOperatorCases({ status: [...OPEN_STATUSES], providerId, limit: 100 }),
    refetchInterval: 60_000,
    retry: 0,
  });
  const listMissing = open.error instanceof ApiError && open.error.status === 404;
  const tabs = listMissing ? FALLBACK_TABS : STATUS_TABS;
  const tab = tabById(tabs, tabId ?? tabParam);

  const list = useInfiniteQuery({
    queryKey: ["operator", "cases", "list", tab.id, providerId ?? null],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listOperatorCases({ status: tab.statuses ?? undefined, providerId, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    enabled: !listMissing && open.isSuccess,
    retry: 0,
  });

  // ── The fallback: only when the list is missing ──
  const disputes = useQuery({
    queryKey: ["operator", "arbiter", "disputes"],
    queryFn: listArbiterDisputes,
    enabled: listMissing,
    refetchInterval: 60_000,
    retry: 0,
  });
  const legacy = useQuery({
    queryKey: ["operator", "queue", "list"],
    queryFn: () => listAdjudicationQueue({ limit: 100 }),
    enabled: listMissing,
    retry: 0,
  });
  const activity = useQuery({
    queryKey: ["operator", "override-log", "penalties-acted-on"],
    queryFn: () => listOverrideLog({ targetType: "slash_proposal", limit: ACTIVITY_LOOKBACK }),
    enabled: listMissing,
    staleTime: 60_000,
    retry: 0,
  });
  const actedIds = React.useMemo(() => [...new Set((activity.data?.items ?? []).map((row) => row.targetId))], [activity.data]);
  const recentIds = React.useMemo(() => recent.map((item) => item.id), [recent]);
  const briefIds = React.useMemo(() => (listMissing ? [...actedIds, ...recentIds] : []), [listMissing, actedIds, recentIds]);
  const briefs = usePenaltyBriefs(briefIds);

  // A two-person request waiting on a penalty is what happens next to it.
  const pending = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: 100 }),
    refetchInterval: 30_000,
    retry: 0,
  });
  const waitingBy = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const approval of pending.data?.items ?? []) {
      const code = PENALTY_APPROVAL_CODES[approval.action];
      if (!code || approval.status !== "PENDING") continue;
      const names = directory.isPending ? [] : eligibleApprovers(code, directory.operators, approval.requestedById);
      map.set(approvalTargetId(approval), waitingText(approval.action, names));
    }
    return map;
  }, [pending.data, directory]);

  let rows: PenaltyRow[];
  let loading: boolean;
  let failed: unknown = null;
  if (!listMissing) {
    rows = (list.data?.pages ?? []).flatMap((page) => page.items.map(rowFromCase));
    loading = open.isLoading || list.isLoading;
    failed = open.isError ? open.error : list.isError ? list.error : null;
  } else if (tab.id === "needs-ruling") {
    rows = uniqueRows([
      ...(disputes.data ?? []).map((d) => rowFromDispute(d, providers.name(d.providerId))),
      ...(legacy.data?.items ?? []).map(rowFromQueue),
    ]);
    loading = disputes.isLoading;
    failed = disputes.isError ? disputes.error : null;
  } else {
    const ids = tab.id === "acted" ? actedIds : recentIds;
    rows = ids.flatMap((id) => {
      const brief = briefs.get(id);
      return brief ? [rowFromBrief(brief, providers.name(brief.case.proposal.providerId), now)] : [];
    });
    loading = tab.id === "acted" ? activity.isLoading : false;
    failed = tab.id === "acted" && activity.isError ? activity.error : null;
  }
  const shown = providerId ? rows : rows.filter((row) => rowMatches(row, q));

  const counts: Partial<Record<PenaltyTabId, number>> = listMissing
    ? {
        "needs-ruling": uniqueRows([
          ...(disputes.data ?? []).map((d) => rowFromDispute(d, "")),
          ...(legacy.data?.items ?? []).map(rowFromQueue),
        ]).length,
        acted: actedIds.length,
        recent: recentIds.length,
      }
    : tabCounts((open.data?.items ?? []).map(rowFromCase));
  const openMore = Boolean(open.data?.pageInfo.nextCursor);
  // Without the list, a source with nothing in it is not drawn at all.
  const visibleTabs = listMissing ? tabs.filter((t) => t.id === "needs-ruling" || (counts[t.id] ?? 0) > 0) : tabs;

  const chooseTab = (next: PenaltyTab) => {
    setTabId(next.id);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next.id);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const id = penaltyIdFrom(query);
    if (id) {
      router.push(routes.operatorCase(id));
      return;
    }
    // Plain text filters as it is typed; Enter on text that is not an id says what Enter is for.
    setQueryError(q && shown.length === 0 ? "No penalty matches. Paste a penalty id or link to open it." : null);
  };

  const recentLine = recent.filter((item) => !rows.some((row) => row.id === item.id)).slice(0, 4);

  return (
    <>
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <h1 className="text-heading-md text-01">Penalties</h1>
        <form onSubmit={submit} role="search" className="flex w-full flex-col gap-1 tablet:w-[360px]" noValidate>
          <Search
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setQueryError(null);
            }}
            placeholder="Provider, penalty id or link"
            aria-label="Find a penalty: provider, penalty id or link"
            shortcut={null}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {queryError ? (
            <p role="alert" className="text-body-xs text-danger-600">
              {queryError}
            </p>
          ) : null}
        </form>
      </header>

      <div role="tablist" aria-label="Penalties by status" className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] tablet:mx-0 tablet:w-full tablet:flex-wrap tablet:px-0 [&::-webkit-scrollbar]:hidden">
        {visibleTabs.map((t) => {
          const selected = t.id === tab.id;
          const count = counts[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => chooseTab(t)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-label-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                selected ? "border-01 bg-inverse text-inverse" : "border-01 bg-01 text-02 hover:bg-02 hover:text-01",
              )}
            >
              {t.label}
              {count !== undefined ? (
                <span className={cn("tabular-nums", selected ? "opacity-80" : "text-03")}>
                  {count}
                  {openMore ? "+" : ""}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section role="tabpanel" aria-label={tab.label} className="flex w-full flex-col gap-3">
        {loading ? (
          <PageState kind="loading" rows={4} label="Loading penalties" />
        ) : failed ? (
          <PageState
            kind="error"
            description="The penalties could not be loaded."
            onRetry={() => {
              void open.refetch();
              void list.refetch();
            }}
            code={failed instanceof ApiError ? failed.code : null}
          />
        ) : shown.length === 0 ? (
          <PageState
            kind="empty"
            bare
            title={q ? `No penalty matches “${q}” here` : EMPTY_TITLE[tab.id]}
            description={q ? (tab.id === "all" ? "Paste a penalty id or link to open it." : "Try the All tab, or paste a penalty id or link.") : EMPTY_TEXT[tab.id]}
          />
        ) : (
          <PenaltyTable rows={shown} waitingBy={waitingBy} now={now} />
        )}
        {!listMissing && list.hasNextPage ? (
          <Button variant="secondary" className="self-start" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            Load more
          </Button>
        ) : null}
        {listMissing ? (
          <p className="text-body-xs text-03">
            This server does not list every penalty yet. One nobody disputed or acted on opens from its link, pasted above.
          </p>
        ) : null}
      </section>

      {!listMissing && recentLine.length > 0 ? (
        <p className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-body-13 text-03">
          <span>Recently opened here:</span>
          {recentLine.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <Link href={routes.operatorCase(item.id)} className="text-02 hover:text-01 hover:underline">
                {labelOf(item, providers.lookup(item.providerId))}
              </Link>
            </React.Fragment>
          ))}
        </p>
      ) : null}
    </>
  );
}

/** The remembered label, renamed when the provider's name is known now. */
function labelOf(item: RecentPenalty, name: string | null): string {
  const amount = /\$[\d,.]+/.exec(item.label)?.[0];
  if (name && amount) return `${name} ${amount}`;
  return item.label.replace(/'s? (\$[\d,.]+) penalty$/, " $1");
}

const EMPTY_TITLE: Record<PenaltyTabId, string> = {
  "needs-ruling": "Nothing to rule on",
  signature: "No cancel waiting for a signature",
  window: "No penalty in its dispute window",
  executed: "No executed penalty",
  cancelled: "No cancelled penalty",
  all: "No penalties yet",
  acted: "Nothing acted on lately",
  recent: "Nothing opened here yet",
};

const EMPTY_TEXT: Record<PenaltyTabId, string> = {
  "needs-ruling": "When a provider disputes a penalty on chain, it shows here with its 30 days to rule.",
  signature: "A penalty suspended after it went on chain waits here until the arbiter key signs its cancel.",
  window: "New penalties wait here while the provider can still dispute them.",
  executed: "Penalties whose stake was taken show here.",
  cancelled: "Cancelled, suspended and expired penalties show here.",
  all: "Penalties show here once Assay proposes one.",
  acted: "Penalties an operator suspended, ruled on or paid back show here, from Activity.",
  recent: "A penalty you open from its link shows here, so you can come back to it.",
};
