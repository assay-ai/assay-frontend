"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { stampUtc } from "@/features/g34a/stats";
import { claimTypeLabel } from "@/features/provider-disputes/claim-types";
import { disputeBadgeVariant } from "@/features/provider-disputes/state";
import type { Dispute } from "@/interfaces/provider-disputes";
import { ApiError } from "@/libs/ApiClient";
import { listDisputes } from "@/services/provider-disputes.service";

/**
 * The dispute list, route `/provider/disputes`.
 *
 * No design frame in the task brief draws this screen — only the filing form
 * and the case-state view do, and this list
 * is the natural landing route between them (and the target of "Back to
 * disputes" on the case-state page). Built to match this app's established
 * list-page conventions (`provider/tool-requests`, `provider/bindings/
 * [bindingId]/verdicts`) rather than inventing a second visual language.
 *
 * `subjectType` includes `SLASH_PROPOSAL` (a value the backend's public
 * `DisputeSubjectType` enum omits but the column actually holds — see
 * `@/interfaces/provider-disputes`'s file header) rendered lower-cased and
 * spaced rather than hidden, since a provider filed some of these rows
 * through the slash-proposal flow specifically.
 */

const LIST_LIMIT = 25;

interface DisputeRow extends TableRowData, Dispute {}

function subjectLabel(dispute: Dispute): string {
  const kind = dispute.subjectType.toLowerCase().replace(/_/g, " ");
  const shortId = dispute.subjectId.length > 8 ? `${dispute.subjectId.slice(0, 8)}…` : dispute.subjectId;
  return `${kind} · ${shortId}`;
}

export default function DisputesListPage() {
  const listQuery = useInfiniteQuery({
    queryKey: ["provider", "disputes", "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listDisputes({ limit: LIST_LIMIT, cursor: pageParam }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const items: Dispute[] = React.useMemo(
    () => (listQuery.data?.pages ?? []).flatMap((page) => page.items),
    [listQuery.data]
  );

  const columns: TableColumn<DisputeRow>[] = [
    {
      key: "filed",
      header: "Filed",
      width: 150,
      mono: true,
      cell: (row) => `${stampUtc(row.createdAt)} UTC`,
    },
    {
      key: "subject",
      header: "Subject",
      width: 220,
      mono: true,
      cell: (row) => (
        <Link href={`/provider/disputes/${row.id}`} className="hover:underline">
          {subjectLabel(row)}
        </Link>
      ),
    },
    {
      key: "claim",
      header: "Claim",
      noTruncate: true,
      cell: (row) => claimTypeLabel(row.claimType),
    },
    {
      key: "state",
      header: "State",
      width: 190,
      align: "start",
      cell: (row) => <Badge variant={disputeBadgeVariant(row.state)} />,
    },
  ];

  return (
    <>
      <header className="flex w-full flex-col items-start gap-0.5">
        <h1 className="text-heading-md text-01">Disputes</h1>
        <p className="text-body-sm text-03">Objections you have filed against a proposed penalty or a verdict</p>
        <p className="text-body-13 text-02">
          <Link href="/provider/capital/penalties" className="underline">
            Penalties on chain
          </Link>{" "}
          lists every penalty against your stake, read from the blockchain rather than from Assay.
        </p>
      </header>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>All disputes</PanelTitle>
            <PanelDescription>newest first</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          {listQuery.isLoading ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : listQuery.isError ? (
            <p className="text-body-13 text-danger-600">
              This list could not be loaded.{" "}
              {listQuery.error instanceof ApiError ? listQuery.error.message : ""}
            </p>
          ) : items.length === 0 ? (
            <EmptyState
              title="No disputes filed"
              description="An objection against a proposed penalty or a verdict appears here once you file one. Filing is free and never affects your routing or tier."
            />
          ) : (
            <div className="w-full overflow-x-auto">
              <Table columns={columns} rows={items} caption="Filed disputes" className="min-w-[760px]" />
            </div>
          )}
        </PanelBody>
      </Panel>

      {listQuery.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={listQuery.isFetchingNextPage}
          onClick={() => listQuery.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </>
  );
}
