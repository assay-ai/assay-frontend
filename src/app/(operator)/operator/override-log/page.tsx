"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { DASH } from "@/features/g34a/stats";
import type { ListOverrideLogQuery, OverrideLogEntry } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { listOverrideLog } from "@/services/operator.service";

/**
 * The override register, read — route `/operator/override-log`.
 *
 * Every manual intervention, newest first, readable by any operator. The
 * filters live in the URL (`?targetType=account_block&targetId=…`) so other
 * screens can link straight to one target's history, as the blocklist does.
 */

const LIST_LIMIT = 25;

interface LogRow extends TableRowData, OverrideLogEntry {}

const FILTER_KEYS = ["targetType", "targetId", "ticketRef", "q"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function OverrideLogContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const applied: Record<FilterKey, string> = {
    targetType: searchParams.get("targetType") ?? "",
    targetId: searchParams.get("targetId") ?? "",
    ticketRef: searchParams.get("ticketRef") ?? "",
    q: searchParams.get("q") ?? "",
  };
  const [draft, setDraft] = React.useState(applied);
  const appliedKey = FILTER_KEYS.map((key) => applied[key]).join("\u0000");
  React.useEffect(() => {
    setDraft(applied);
    // Re-sync the boxes when the URL changes from outside (a link, back).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const query: ListOverrideLogQuery = {
    targetType: applied.targetType || undefined,
    targetId: applied.targetId || undefined,
    ticketRef: applied.ticketRef || undefined,
    q: applied.q || undefined,
  };

  const log = useInfiniteQuery({
    queryKey: ["operator", "override-log", query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listOverrideLog({ limit: LIST_LIMIT, cursor: pageParam, ...query }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const rows: LogRow[] = React.useMemo(
    () => (log.data?.pages ?? []).flatMap((page) => page.items),
    [log.data],
  );

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = draft[key].trim();
      if (value) params.set(key, value);
    }
    const search = params.toString();
    router.replace(search ? `/operator/override-log?${search}` : "/operator/override-log");
  }

  const columns: TableColumn<LogRow>[] = [
    { key: "at", header: "When", width: 170, mono: true, cell: (row) => when(row.createdAt) },
    {
      key: "action",
      header: "Action",
      noTruncate: true,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-mono-12 text-01">{row.code}</span>
          <span className="text-body-xs text-02">{row.label}</span>
        </span>
      ),
    },
    {
      key: "who",
      header: "Who",
      noTruncate: true,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-body-xs text-01">{row.actorSubject}</span>
          <span className="text-body-xs text-03">
            {row.approverSubject ? `approved by ${row.approverSubject}` : row.approvalMode.toLowerCase()}
          </span>
        </span>
      ),
    },
    {
      key: "target",
      header: "Target",
      noTruncate: true,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-mono-12 text-02">{row.targetType}</span>
          <span className="break-all font-mono text-mono-12 text-01">{row.targetId}</span>
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      noTruncate: true,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-mono-12 text-01">{row.reasonCode}</span>
          <span className="text-body-xs text-02 [overflow-wrap:anywhere]">{row.reason}</span>
        </span>
      ),
    },
    {
      key: "ticket",
      header: "Ticket",
      width: 110,
      mono: true,
      cell: (row) => row.ticketRef ?? DASH,
    },
  ];

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Override log</h1>
          <p className="text-body-sm text-03">every manual intervention, newest first</p>
        </div>
        {applied.targetType === "account_block" ? (
          <Link href="/operator/blocks" className="text-label-13 text-primary-600 hover:underline">
            Back to account blocks
          </Link>
        ) : null}
      </header>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Entries</PanelTitle>
            <PanelDescription>
              {applied.targetType ? `target type ${applied.targetType}` : "all targets"}
              {applied.targetId ? ` · ${applied.targetId}` : ""}
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <form
            onSubmit={apply}
            className="mb-4 grid w-full grid-cols-1 items-end gap-3 tablet:grid-cols-2 desktop:grid-cols-5"
            aria-label="Override log filters"
          >
            <Field
              label="Target type"
              value={draft.targetType}
              onChange={(e) => setDraft((d) => ({ ...d, targetType: e.target.value }))}
              placeholder="account_block"
              autoComplete="off"
            />
            <Field
              label="Target id"
              value={draft.targetId}
              onChange={(e) => setDraft((d) => ({ ...d, targetId: e.target.value }))}
              autoComplete="off"
              spellCheck={false}
            />
            <Field
              label="Ticket"
              value={draft.ticketRef}
              onChange={(e) => setDraft((d) => ({ ...d, ticketRef: e.target.value }))}
              autoComplete="off"
            />
            <Field
              label="Search the reason"
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              autoComplete="off"
            />
            <Button type="submit" variant="secondary" className="self-end">
              Apply
            </Button>
          </form>

          {log.isLoading ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : log.isError ? (
            <p className="text-body-13 text-danger-600" role="alert">
              The override log could not be loaded.{" "}
              {log.error instanceof ApiError ? `${log.error.message} (${log.error.code})` : ""}
            </p>
          ) : rows.length === 0 ? (
            <EmptyState title="No entries" description="No intervention matches these filters." />
          ) : (
            <div className="w-full overflow-x-auto">
              <Table columns={columns} rows={rows} caption="Override log" className="min-w-[1080px]" />
            </div>
          )}
        </PanelBody>
      </Panel>

      {log.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </>
  );
}

export default function OverrideLogPage() {
  // `useSearchParams()` needs a Suspense boundary to build.
  return (
    <React.Suspense fallback={null}>
      <OverrideLogContent />
    </React.Suspense>
  );
}
