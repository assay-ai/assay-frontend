"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Plus, Wrench } from "lucide-react";
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
import { PageHeader } from "@/features/provider-binding/chrome";
import type { CatalogueTool, ToolBindingSummary, ToolCatalogue } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { listToolBindings, listToolCatalogue } from "@/services/provider-tool-bindings.service";
import { formatMoney } from "@/utils/money";
import { shortBindingId } from "@/utils/provider-label";
import { routes } from "@/libs/routes";

/**
 * The binding list, route `/provider/bindings`.
 *
 * Until this route existed, `bindings/` held only `[bindingId]/` — every
 * binding screen in the console was reachable only from the sidebar rail or by
 * already knowing a uuid, and the dashboard's "New binding" button was drawn
 * disabled because there was nowhere to send anyone. This is the index those
 * two were missing.
 *
 * ## The first caller that actually pages
 *
 * `listToolBindings` has eight other callers — the sidebar, the dashboard, the
 * portfolio, capital, money, policy-changes and two `(minimal)` screens — and
 * every one of them asks for `{ limit: 50 }` and stops reading. That is
 * defensible on a rail or a tile: they show a bounded slice on purpose. It is
 * not defensible on the index, which is the one screen that claims to list
 * *all* of them, so this is the first caller to spend `pageInfo.nextCursor` /
 * `pageInfo.hasMore` — via `useInfiniteQuery`, the same idiom
 * `/provider/disputes` uses, so the two lists page identically.
 *
 * ## Why the tool name needs a second request
 *
 * `ToolBindingSummary` carries `toolId` and nothing else about the tool; the
 * detail route adds nothing either. The name lives only in
 * `GET /providers/me/tool-bindings/catalogue`, so the name column is a join
 * against it, under the same query key the configuration screen already uses
 * (`["provider", "tool-catalogue"]`) so opening this page costs no extra round
 * trip once either has run.
 *
 * A `toolId` that is not in the catalogue is a **real state**, not an error:
 * the catalogue is seeded from a file, a tool can be withdrawn from it, and a
 * binding written against the old seed keeps its row. Such a row renders its
 * uuid, marked, rather than a blank cell or a crash — the binding is still
 * live, still earning and still the provider's to manage. `labelForEndpoint`
 * is deliberately *not* used as the fallback: the endpoint host is already its
 * own column here, so falling back to it would print the same string twice and
 * hide the fact that the join missed.
 *
 * A catalogue request that fails is the same shape as a missing tool and is
 * rendered the same way. The list itself does not depend on it.
 */

/** Em dash for a value with no honest source. Never a synthetic zero. */
const DASH = "—";

const LIST_LIMIT = 25;

interface BindingRow extends TableRowData {
  binding: ToolBindingSummary;
  tool: CatalogueTool | undefined;
}

/**
 * `PAUSED`, `DRAFT` and `SUSPENDED` are not in `badge.tsx`'s closed variant
 * vocabulary, and that component deliberately has no `label` prop. The
 * dashboard (`provider/page.tsx`) hit this first and drew the missing pill
 * inline from the `not-sampled` variant's geometry — `bg-03`, `text-02`, dot
 * disabled — rather than editing the shared file. The same data on the same
 * console reads the same way here.
 */
function StatusBadge({ status }: { status: ToolBindingSummary["status"] }) {
  if (status === "ACTIVE") return <Badge variant="active" />;
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-03 px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px] text-02">
      {status}
    </span>
  );
}

/**
 * A FREE binding has no price to state — an em dash, not `$0.0000`. Four
 * decimals is the per-call precision every other provider screen prices at.
 */
function priceCell(binding: ToolBindingSummary): string {
  if (binding.pricingMode === "FREE") return DASH;
  return formatMoney(binding.price, { decimals: 4 });
}

/** `https://api.open-meteo.com/v1/forecast` → `api.open-meteo.com`. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export default function ProviderBindingsListPage() {
  const listQuery = useInfiniteQuery({
    queryKey: ["provider", "tool-bindings", "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listToolBindings({ limit: LIST_LIMIT, cursor: pageParam }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? last.pageInfo.nextCursor ?? undefined : undefined),
    retry: 0,
  });

  const catalogueQuery = useQuery<ToolCatalogue, ApiError>({
    queryKey: ["provider", "tool-catalogue"],
    queryFn: listToolCatalogue,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });

  const items: ToolBindingSummary[] = React.useMemo(
    () => (listQuery.data?.pages ?? []).flatMap((page) => page.items),
    [listQuery.data]
  );

  const toolsById = React.useMemo(() => {
    const map = new Map<string, CatalogueTool>();
    for (const tool of catalogueQuery.data?.tools ?? []) map.set(tool.id, tool);
    return map;
  }, [catalogueQuery.data]);

  const rows: BindingRow[] = items.map((binding) => ({
    id: binding.id,
    binding,
    tool: toolsById.get(binding.toolId),
  }));

  const columns: TableColumn<BindingRow>[] = [
    {
      key: "tool",
      header: "Tool",
      mono: true,
      cell: (row) => (
        <Link href={routes.binding(row.binding.id)} className="min-w-0 truncate hover:underline">
          {row.tool ? (
            <span className="font-semibold">{row.tool.name}</span>
          ) : (
            <>
              <span className="font-semibold">{shortBindingId(row.binding.toolId)}…</span>
              <span className="text-02"> · not in catalogue</span>
            </>
          )}
        </Link>
      ),
    },
    {
      key: "endpoint",
      header: "Endpoint",
      width: 220,
      align: "end",
      mono: true,
      cell: (row) => hostOf(row.binding.endpoint),
    },
    {
      key: "mode",
      header: "Pricing",
      width: 110,
      align: "end",
      mono: true,
      cell: (row) => row.binding.pricingMode,
    },
    {
      key: "price",
      header: "Price",
      width: 110,
      align: "end",
      mono: true,
      cell: (row) => priceCell(row.binding),
    },
    {
      key: "status",
      header: "Status",
      width: 130,
      align: "end",
      cell: (row) => <StatusBadge status={row.binding.status} />,
    },
  ];

  const headerFacts = listQuery.isLoading
    ? "loading…"
    : `${items.length} binding${items.length === 1 ? "" : "s"}${
        listQuery.hasNextPage ? "+" : ""
      } · one per tool`;

  return (
    <>
      <PageHeader
        title="Tool bindings"
        sub={headerFacts}
        actions={
          <Button asChild>
            {/* `asChild` hands the whole child to Radix Slot, so Button's own
                `icon` prop would be dropped — the icon rides inside the Link. */}
            <Link href="/provider/bindings/new">
              <Plus aria-hidden="true" />
              New binding
            </Link>
          </Button>
        }
      />

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>All bindings</PanelTitle>
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
          ) : rows.length === 0 ? (
            <div className="flex w-full flex-col items-start gap-3.5">
              <EmptyState
                icon={<Wrench width={22} height={22} />}
                title="No bindings yet"
                description="A binding is your implementation of one catalogue tool — an endpoint, a price and the two mappings between the tool's schema and your API. Create one to start taking traffic; it stays a draft until you test and publish it."
              />
              <Button asChild>
                <Link href="/provider/bindings/new">
                  <Plus aria-hidden="true" />
                  New binding
                </Link>
              </Button>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <Table
                columns={columns}
                rows={rows}
                caption="Your tool bindings"
                className="min-w-[760px]"
              />
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
