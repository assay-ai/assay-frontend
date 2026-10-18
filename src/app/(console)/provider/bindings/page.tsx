"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PROVIDER_TOOLS_TABS } from "@/components/layout/provider-nav-config";
import { SectionTabs } from "@/components/layout/section-tabs";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { bindingStatusChip } from "@/features/provider-binding/binding-header";
import { LISTING_KINDS_SENTENCE, listingKind, liveFirst, priceLine } from "@/features/provider-binding/listing-copy";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { REPLY_PROMISE } from "@/features/provider-tool-requests/request-sheet";
import type { ToolBindingSummary } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { discardToolBinding, listToolBindings } from "@/services/provider-tool-bindings.service";

/**
 * Listings — every catalogue tool you serve, by name, live first, with its
 * state and price, and one way to add another. A draft opens the wizard where
 * it was left, and can be discarded; a published listing opens its Overview.
 * A row never shows its address (host, IP or port), only the tool and its
 * kind; the address is in the listing's Settings → Connection.
 */

const LIST_LIMIT = 25;

/** What discarding says when the API refuses: the listing went past the draft meanwhile. */
function discardError(error: unknown): string {
  if (error instanceof ApiError && error.code === "PROVIDER_BINDING_NOT_DISCARDABLE") {
    return "This listing was published or already took calls, so it can no longer be discarded. Pause it instead.";
  }
  return error instanceof ApiError ? plainError(error.code, error.status) : "It could not be discarded. Try again.";
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
  const items = React.useMemo(() => liveFirst((listQuery.data?.pages ?? []).flatMap((page) => page.items)), [listQuery.data]);
  const queryClient = useQueryClient();
  const [discarding, setDiscarding] = React.useState<ToolBindingSummary | null>(null);

  return (
    <>
      <SectionTabs tabs={PROVIDER_TOOLS_TABS} label="Listings" />
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Listings</h1>
          <p className="text-body-13 text-03">
            {LISTING_KINDS_SENTENCE}{" "}
            <Link href="/provider/apis" className="text-primary-600 hover:underline">
              Your APIs
            </Link>
            {" · "}
            <Link href="/provider/tool-requests" className="text-primary-600 hover:underline">
              Tool requests
            </Link>
          </p>
        </div>
        <Button asChild>
          <Link href={routes.bindingWizard()}>
            <Plus aria-hidden="true" />
            List a tool
          </Link>
        </Button>
      </header>

      {listQuery.isPending ? (
        <PageState kind="loading" rows={4} label="Loading your listings" />
      ) : listQuery.isError ? (
        <PageState
          kind="error"
          description="Your listings could not be loaded."
          onRetry={() => void listQuery.refetch()}
          code={listQuery.error instanceof ApiError ? listQuery.error.code : null}
        />
      ) : items.length === 0 ? (
        <PageState
          kind="empty"
          title="No listings yet"
          description="List your first tool: pick what your API does, connect it, run a test and publish. It takes a few minutes."
          action={{ label: "List your first tool", href: routes.bindingWizard() }}
        />
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-lg border border-01 bg-01">
          {items.map((binding) => {
            const draft = binding.status === "DRAFT";
            const href = draft ? routes.bindingWizard(binding.id) : routes.binding(binding.id);
            return (
              <li key={binding.id} className="flex flex-col border-t border-01 first:border-t-0 tablet:flex-row tablet:items-center">
                <Link
                  href={href}
                  className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3.5 hover:bg-02 focus-visible:bg-02 focus-visible:outline-none tablet:flex-row tablet:items-center tablet:gap-4"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-label-sm text-01">{names.bindingLabel(binding)}</span>
                    {listingKind(names.toolName(binding.toolId)) ? (
                      <span className="truncate text-body-xs text-03">{listingKind(names.toolName(binding.toolId))}</span>
                    ) : null}
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
                {draft ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mx-4 mb-3 self-start tablet:mx-0 tablet:mb-0 tablet:mr-3 tablet:self-center"
                    icon={<Trash2 aria-hidden="true" />}
                    onClick={() => setDiscarding(binding)}
                  >
                    Discard draft
                  </Button>
                ) : null}
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
        <Link href="/provider/tool-requests" className="inline-flex min-h-10 items-center text-primary-600 hover:underline">
          Request it
        </Link>
        . {REPLY_PROMISE}
      </p>

      <ConfirmSheet
        open={discarding !== null}
        onOpenChange={(open) => (open ? null : setDiscarding(null))}
        title={`Discard the ${discarding ? names.bindingLabel(discarding) : ""} draft?`}
        description="It was never published, so no agent has called it. This deletes the draft, its test runs and any API key headers stored for it. It cannot be undone; you can list the tool again from the start."
        confirmLabel="Discard draft"
        onConfirm={async () => {
          if (!discarding) return;
          await discardToolBinding(discarding.id);
          setDiscarding(null);
          await queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings"] });
        }}
        describeError={discardError}
      />
    </>
  );
}
