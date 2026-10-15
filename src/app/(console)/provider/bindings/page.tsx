"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { bindingStatusChip } from "@/features/provider-binding/binding-header";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import type { ToolBindingSummary } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { formatMoneyNonZero } from "@/utils/money";
import { labelForEndpoint } from "@/utils/provider-label";

/**
 * Tools — every tool you list, by name, with its state and price, and one
 * way to add another. A draft opens the wizard where it was left; a live
 * tool opens its Overview.
 */

const LIST_LIMIT = 25;

function priceLine(binding: ToolBindingSummary): string {
  if (binding.pricingMode === "FREE") return "Free";
  const price = `${formatMoneyNonZero(binding.price)} a call`;
  return binding.pricingMode === "FREEMIUM" ? `Free calls, then ${price}` : price;
}

export default function ProviderToolsPage() {
  const names = useProviderToolNames();
  const listQuery = useInfiniteQuery({
    queryKey: ["provider", "tool-bindings", "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listToolBindings({ limit: LIST_LIMIT, cursor: pageParam }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    retry: 0,
  });
  const items = React.useMemo(() => (listQuery.data?.pages ?? []).flatMap((page) => page.items), [listQuery.data]);

  return (
    <>
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Tools</h1>
          <p className="text-body-13 text-03">The tools you list for agents to call. One listing per tool.</p>
        </div>
        <Button asChild>
          <Link href={routes.bindingWizard()}>
            <Plus aria-hidden="true" />
            List a tool
          </Link>
        </Button>
      </header>

      {listQuery.isPending ? (
        <PageState kind="loading" rows={4} label="Loading your tools" />
      ) : listQuery.isError ? (
        <PageState
          kind="error"
          description="Your tools could not be loaded."
          onRetry={() => void listQuery.refetch()}
          code={listQuery.error instanceof ApiError ? listQuery.error.code : null}
        />
      ) : items.length === 0 ? (
        <PageState
          kind="empty"
          title="No tools yet"
          description="List your first tool: pick what your API does, connect it, run a test and publish. It takes a few minutes."
          action={{ label: "List your first tool", href: routes.bindingWizard() }}
        />
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-lg border border-01 bg-01">
          {items.map((binding) => {
            const draft = binding.status === "DRAFT";
            const href = draft ? routes.bindingWizard(binding.id) : routes.binding(binding.id);
            return (
              <li key={binding.id} className="border-t border-01 first:border-t-0">
                <Link
                  href={href}
                  className="flex flex-col gap-1.5 px-4 py-3.5 hover:bg-02 focus-visible:bg-02 focus-visible:outline-none tablet:flex-row tablet:items-center tablet:gap-4"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-label-sm text-01">{names.bindingLabel(binding)}</span>
                    <span className="truncate font-mono text-mono-xs text-03">{labelForEndpoint(binding.endpoint)}</span>
                  </span>
                  <span className="text-body-13 text-02 tablet:w-56 tablet:text-right">{priceLine(binding)}</span>
                  <span className="flex items-center gap-2 tablet:w-44 tablet:justify-end">
                    <StatusChip status={bindingStatusChip(binding.status)} />
                    {draft ? (
                      <span className="flex items-center gap-1 text-label-xs text-primary-600">
                        Continue setup <ArrowRight aria-hidden="true" className="size-3" />
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {listQuery.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={listQuery.isFetchingNextPage}
          onClick={() => void listQuery.fetchNextPage()}
        >
          Show more
        </Button>
      ) : null}

      <p className="text-body-13 text-02">
        Can&apos;t find the tool your API provides?{" "}
        <Link href="/provider/tool-requests" className="text-primary-600 hover:underline">
          Request it
        </Link>
        . We reply within 2 working days in your Inbox.
      </p>
    </>
  );
}
