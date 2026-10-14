"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { DASH, count, percent } from "@/features/g34a/stats";
import { SlashHoldsPanel } from "@/features/operator/slash-holds-panel";
import { caseBadgeVariant } from "@/features/operator/state";
import { remaining } from "@/features/provider-slash-case/status-header";
import type { AdjudicationQueueRow } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { formatMoney } from "@/utils/money";
import { getPlatformHealth, listAdjudicationQueue } from "@/services/operator.service";
import { routes } from "@/libs/routes";

/**
 * The adjudication queue, route `/operator`.
 *
 * The landing screen of the operator console: six platform-health tiles over
 * the queue of slash proposals a provider has objected to.
 *
 * ## The queue's order is the product
 *
 * `GET /operator/queue` orders by time-to-deadline then penalty size, fixed
 * server-side — a caller cannot ask for insertion order. So this screen offers
 * no sort control: the one thing an adjudicator must not be able to do is work
 * the queue oldest-first while a case with two hours left sits below the fold.
 *
 * ## Why there are two empty states
 *
 * The backend applies `mine` / `unassigned` / `overdue` **after** keyset
 * pagination, so a filtered page can come back with zero rows while
 * `hasMore` is true. "Nothing to adjudicate" would then be a false statement
 * about the queue rather than about the page, which is why the filtered case
 * says only what it can honestly say — see `listAdjudicationQueue`'s own note.
 */

const LIST_LIMIT = 25;

interface QueueRow extends TableRowData, AdjudicationQueueRow {}

/**
 * `elapsed()` in `@/features/g34a/stats` takes an ISO stamp and a clock;
 * `PlatformHealth`'s two age fields are already a number of seconds. Reading
 * them in the same `2h 5m` shape here keeps the two tiles identical to each
 * other without reconstructing a timestamp only to subtract it again.
 */
function ageFromSeconds(seconds: number | null): string {
  if (seconds === null) return DASH;
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** `PLATFORM_MAPPING_CHANGE` → `platform mapping change`. */
function claimLabel(claimType: string | null): string {
  return claimType === null ? DASH : claimType.toLowerCase().replace(/_/g, " ");
}

export default function AdjudicationQueuePage() {
  const [mine, setMine] = React.useState(false);
  const [unassigned, setUnassigned] = React.useState(false);
  const [overdue, setOverdue] = React.useState(false);

  /*
    Only the filters that are ON are sent. `mine=false` is not the same request
    as no `mine` at all — it would ask the server to narrow to cases that are
    explicitly not mine, which is not what an unticked box means.
  */
  const filters = {
    mine: mine || undefined,
    unassigned: unassigned || undefined,
    overdue: overdue || undefined,
  };
  const anyFilter = mine || unassigned || overdue;

  const healthQuery = useQuery({
    queryKey: ["operator", "health"],
    queryFn: getPlatformHealth,
    retry: 0,
  });

  const queueQuery = useInfiniteQuery({
    // `filters` is part of the key, so ticking a box restarts from a fresh
    // cursor rather than appending a differently-filtered page to the old one.
    queryKey: ["operator", "queue", "list", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAdjudicationQueue({ limit: LIST_LIMIT, cursor: pageParam, ...filters }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const health = healthQuery.data;

  const rows: QueueRow[] = React.useMemo(
    () =>
      (queueQuery.data?.pages ?? []).flatMap((page) =>
        page.items.map((row) => ({ ...row, id: row.proposalId })),
      ),
    [queueQuery.data],
  );

  const columns: TableColumn<QueueRow>[] = [
    {
      key: "case",
      header: "Case",
      noTruncate: true,
      cell: (row) => (
        <Link href={routes.operatorCase(row.proposalId)} className="hover:underline">
          {row.caseLabel}
        </Link>
      ),
    },
    {
      key: "provider",
      header: "Provider",
      cell: (row) => row.providerName,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge variant={caseBadgeVariant(row.status)} />,
    },
    {
      key: "claim",
      header: "Claim",
      cell: (row) => claimLabel(row.claimType),
    },
    {
      key: "penalty",
      header: "Penalty",
      width: 110,
      mono: true,
      cell: (row) => formatMoney(row.penaltyAmount),
    },
    {
      key: "remaining",
      header: "Remaining",
      width: 130,
      mono: true,
      // Red is the whole point of the column once the deadline has passed: the
      // sweeper overturns an overdue case against us, so this is a loss the
      // adjudicator still has a chance to stop, not a status.
      cell: (row) => (
        <span className={row.overdue ? "text-danger-600" : undefined}>
          {remaining(row.secondsToDeadline) ?? DASH}
        </span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      // A running clock with nobody's name on it is the exact failure this
      // queue exists to prevent, so the red here is specified, not decorative.
      cell: (row) =>
        row.ownerSubject ?? <span className="text-danger-600">unassigned</span>,
    },
    {
      key: "coFailures",
      header: "Co-failures",
      width: 90,
      mono: true,
      cell: (row) => count(row.coFailureCount),
    },
    {
      key: "rootCause",
      header: "Root cause",
      cell: (row) =>
        row.rootCauseGroupSize > 1
          ? `${row.rootCauseKey} · ${row.rootCauseGroupSize} cases`
          : DASH,
    },
  ];

  return (
    <>
      <header className="flex w-full flex-col items-start gap-0.5">
        <h1 className="text-heading-md text-01">Adjudication queue</h1>
        <p className="text-body-sm text-03">
          ordered by time remaining, then penalty size — never by age
        </p>
      </header>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Platform health</PanelTitle>
            <PanelDescription>read live, not cached</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          {healthQuery.isLoading ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : healthQuery.isError ? (
            <p className="text-body-13 text-danger-600">
              Platform health could not be loaded.{" "}
              {healthQuery.error instanceof ApiError ? healthQuery.error.message : ""}
            </p>
          ) : health ? (
            <div className="grid w-full grid-cols-1 gap-3.5 tablet:grid-cols-2 desktop:grid-cols-3">
              <MetricTile
                label="Intents / minute"
                value={count(health.intentsPerMinute)}
                sub="per minute"
                meta={
                  health.intentsPerMinuteDeltaVsHour === null
                    ? DASH
                    : `${percent(health.intentsPerMinuteDeltaVsHour)} vs an hour ago`
                }
              />
              <MetricTile
                label="Verification backlog"
                value={count(health.verificationBacklog)}
                sub="pending"
                meta={
                  health.verificationBacklogP95AgeSeconds === null
                    ? DASH
                    : `p95 age ${ageFromSeconds(health.verificationBacklogP95AgeSeconds)}`
                }
              />
              {/*
                A rate at or above the gate is a breach, not a caution — but
                `MetricTile` has exactly two meta tones, "default" and
                "warning", and adding a danger tone to a shared primitive is
                out of scope here (shared primitives are not redesigned
                for one screen). So "warning" carries the breach, and the
                meta line names the gate the rate is being read against so the
                comparison is legible without the colour.
              */}
              <MetricTile
                label="False-positive rate"
                value={percent(health.falsePositiveRate)}
                sub="of resolved proposals"
                meta={`gate ${percent(health.falsePositiveGate)}`}
                metaTone={
                  health.falsePositiveRate >= health.falsePositiveGate ? "warning" : "default"
                }
              />
              <MetricTile
                label="Policies in shadow"
                value={`${health.policiesInShadow} / ${health.policiesTotal}`}
                sub="in shadow mode"
              />
              <MetricTile
                label="Stake locked"
                value={formatMoney(health.stakeLocked)}
                sub={`${count(health.providersWithStake)} ${
                  health.providersWithStake === 1 ? "provider" : "providers"
                }`}
              />
              <MetricTile
                label="Open disputes"
                value={count(health.openDisputes)}
                sub="open"
                meta={
                  health.oldestOpenDisputeAgeSeconds === null
                    ? DASH
                    : `oldest ${ageFromSeconds(health.oldestOpenDisputeAgeSeconds)}`
                }
              />
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      {healthQuery.isError ? null : (
        <SlashHoldsPanel holds={health?.slashHolds} loading={healthQuery.isLoading} />
      )}

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Cases</PanelTitle>
            <PanelDescription>
              disputed, under review or awaiting a second signature
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          {/*
            Three independent booleans, so three checkboxes rather than
            `Segmented` — that control is a single-select group over one
            `value: string` and cannot hold two filters on at once.
          */}
          <div
            className="mb-4 flex w-full flex-wrap items-center gap-x-5 gap-y-2.5"
            role="group"
            aria-label="Queue filters"
          >
            <Checkbox
              label="Mine"
              checked={mine}
              onChange={(event) => setMine(event.target.checked)}
            />
            <Checkbox
              label="Unassigned"
              checked={unassigned}
              onChange={(event) => setUnassigned(event.target.checked)}
            />
            <Checkbox
              label="Overdue"
              checked={overdue}
              onChange={(event) => setOverdue(event.target.checked)}
            />
          </div>

          {queueQuery.isLoading ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : queueQuery.isError ? (
            <p className="text-body-13 text-danger-600">
              The queue could not be loaded.{" "}
              {queueQuery.error instanceof ApiError ? queueQuery.error.message : ""}
            </p>
          ) : rows.length === 0 ? (
            anyFilter ? (
              <EmptyState
                title="No matches on this page"
                description="Filters are applied after pagination, so a later page may still match. Load more, or clear the filters."
              />
            ) : (
              <EmptyState
                title="Nothing to adjudicate"
                description="The queue holds cases a provider has objected to — DISPUTED, UNDER_REVIEW or AWAITING_SECOND. A proposal nobody has objected to yet is not in it, and will resolve on its own if the provider's window closes."
              />
            )
          ) : (
            <div className="w-full overflow-x-auto">
              <Table
                columns={columns}
                rows={rows}
                caption="Adjudication queue"
                className="min-w-[1080px]"
              />
            </div>
          )}
        </PanelBody>
      </Panel>

      {queueQuery.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={queueQuery.isFetchingNextPage}
          onClick={() => queueQuery.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </>
  );
}
