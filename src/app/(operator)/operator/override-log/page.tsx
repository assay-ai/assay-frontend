"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_KINDS,
  activitySentence,
  isOfKind,
  targetTypeOf,
  type ActivityKind,
} from "@/features/operator/activity";
import { blockSubjectLabel } from "@/features/operator/block-targets";
import { operatorLabel } from "@/features/operator/inbox";
import { useOperatorDirectory, useProviderNames } from "@/features/operator/use-operator-lookups";
import type { OverrideLogEntry } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { listAccountBlocks, listOverrideLog } from "@/services/operator.service";
import { cn } from "@/utils";

/**
 * Activity, route `/operator/override-log`: every manual intervention, newest
 * first, as sentences — "Jordan blocked Wallet 0x9f3C…F36c (Leaked key),
 * approved by Dan" — with a link to what it was about.
 *
 * Kind chips and one search box. `?targetId=` shows one record's history (the
 * "History" links on penalties, blocks and approvals); `?kind=` and `?q=`
 * are kept in the URL so a filtered view can be shared.
 */

const LIST_LIMIT = 25;
const KINDS = new Set(ACTIVITY_KINDS.map((kind) => kind.id));

function ActivityScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kindParam = searchParams.get("kind") as ActivityKind | null;
  const kind: ActivityKind = kindParam && KINDS.has(kindParam) ? kindParam : "all";
  const q = searchParams.get("q") ?? "";
  const targetId = searchParams.get("targetId") ?? "";
  const [draft, setDraft] = React.useState(q);
  React.useEffect(() => setDraft(q), [q]);

  const directory = useOperatorDirectory();
  const providers = useProviderNames();
  const blocks = useQuery({
    queryKey: ["operator", "blocks", "lookup"],
    queryFn: () => listAccountBlocks({ limit: 100 }),
    retry: 0,
  });

  const setParams = (next: { kind?: ActivityKind; q?: string; targetId?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.kind !== undefined) {
      if (next.kind === "all") params.delete("kind");
      else params.set("kind", next.kind);
    }
    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q.trim());
      else params.delete("q");
    }
    if (next.targetId === null) params.delete("targetId");
    const query = params.toString();
    router.replace(query ? `/operator/override-log?${query}` : "/operator/override-log", { scroll: false });
  };

  const log = useInfiniteQuery({
    queryKey: ["operator", "override-log", { kind, q, targetId }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listOverrideLog({
        limit: LIST_LIMIT,
        cursor: pageParam,
        targetType: targetTypeOf(kind),
        targetId: targetId || undefined,
        q: q || undefined,
      }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const rows = React.useMemo(
    () => (log.data?.pages ?? []).flatMap((page) => page.items).filter((row) => isOfKind(row, kind)),
    [log.data, kind],
  );

  const blockById = React.useMemo(() => new Map((blocks.data?.items ?? []).map((b) => [b.id, b])), [blocks.data]);
  const names = React.useMemo(
    () => ({
      operator: directory.nameOf,
      target: (entry: Pick<OverrideLogEntry, "targetType" | "targetId">) => {
        if (entry.targetType === "account_block") {
          const block = blockById.get(entry.targetId);
          return block ? blockSubjectLabel(block, providers.lookup) : null;
        }
        if (entry.targetType === "operator") {
          const op = directory.operators.find((o) => o.id === entry.targetId);
          return op ? operatorLabel(op) : null;
        }
        return null;
      },
    }),
    [blockById, directory, providers],
  );

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Activity</h1>
        <p className="text-body-13 text-03">Every manual action on the platform, who did it and who approved it. Newest first.</p>
      </header>

      <div className="flex w-full flex-col gap-2.5 tablet:flex-row tablet:items-center tablet:justify-between">
        <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-2">
          {ACTIVITY_KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={kind === option.id}
              onClick={() => setParams({ kind: option.id })}
              className={cn(
                "inline-flex min-h-8 items-center rounded-full border px-3 text-label-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                kind === option.id ? "border-primary-500 bg-primary-10 text-01" : "border-02 bg-01 text-02 hover:text-01",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setParams({ q: draft });
          }}
          className="flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500 tablet:max-w-[320px]"
          role="search"
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-03" />
          <label className="sr-only" htmlFor="activity-search">
            Search activity
          </label>
          <input
            id="activity-search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search: who, reason, ticket"
            className="w-full min-w-0 bg-transparent text-body-sm text-01 outline-none placeholder:text-03"
          />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setParams({ q: "" })} className="text-03 hover:text-01">
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </form>
      </div>

      {targetId ? (
        <p className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-primary-20 bg-primary-10 px-3.5 py-2 text-body-13 text-01">
          Showing the history of one record.
          <button type="button" onClick={() => setParams({ targetId: null })} className="text-label-13 text-primary-600 hover:underline">
            Show everything
          </button>
        </p>
      ) : null}

      {log.isLoading ? (
        <PageState kind="loading" rows={5} label="Loading activity" />
      ) : log.isError ? (
        <PageState
          kind="error"
          description="Activity could not be loaded."
          onRetry={() => void log.refetch()}
          code={log.error instanceof ApiError ? log.error.code : null}
        />
      ) : rows.length === 0 ? (
        <PageState
          kind="empty"
          title="Nothing here"
          description={
            kind === "arbiter" && log.hasNextPage
              ? "No arbiter action in the latest entries. Older ones may still match."
              : q || targetId || kind !== "all"
                ? "Nothing matches these filters."
                : "No manual action has been taken yet."
          }
          action={kind === "arbiter" && log.hasNextPage ? { label: "Look further back", onClick: () => void log.fetchNextPage() } : undefined}
        />
      ) : (
        <ol className="flex w-full flex-col rounded-xl border border-01 bg-01">
          {rows.map((row) => {
            const sentence = activitySentence(row, names);
            return (
              <li key={row.id} className="flex w-full flex-col gap-1 border-b border-01 px-4 py-3 last:border-b-0">
                <p className="text-body-13 text-01 [overflow-wrap:anywhere]">
                  <span className="font-medium">{sentence.actor}</span> {sentence.verb}{" "}
                  {sentence.href ? (
                    <Link href={sentence.href} className="text-primary-600 hover:underline">
                      {sentence.target}
                    </Link>
                  ) : (
                    sentence.target
                  )}
                  {sentence.reason ? <span className="text-02"> ({sentence.reason})</span> : null}
                  {sentence.approver ? <span className="text-02">, approved by {sentence.approver}</span> : null}
                  {row.breakGlass ? <span className="text-danger-600"> · emergency override</span> : null}
                </p>
                <p className="flex flex-wrap gap-x-2 text-body-xs text-03">
                  <LocalTime value={row.createdAt} />
                  {row.ticketRef ? <span>· {row.ticketRef}</span> : null}
                </p>
                {row.reason ? (
                  <details className="text-body-xs text-02">
                    <summary className="cursor-pointer select-none text-03 hover:text-01">Note</summary>
                    <p className="mt-1 [overflow-wrap:anywhere]">{row.reason}</p>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {log.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          Load more
        </Button>
      ) : null}
    </>
  );
}

export default function ActivityPage() {
  return (
    <React.Suspense fallback={null}>
      <ActivityScreen />
    </React.Suspense>
  );
}
