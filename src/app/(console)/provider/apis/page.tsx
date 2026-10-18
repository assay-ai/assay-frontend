"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lightbulb, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PROVIDER_TOOLS_TABS } from "@/components/layout/provider-nav-config";
import { SectionTabs } from "@/components/layout/section-tabs";
import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { providerToolState } from "@/features/provider-tools/model";
import { providerToolKeys } from "@/features/provider-tools/queries";
import { ProviderToolChips } from "@/features/provider-tools/ui";
import { ApiError } from "@/libs/ApiClient";
import { DEFAULT_SLA_FAILURE_RATE } from "@/libs/dispute-deadlines";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { createToolBinding } from "@/services/provider-tool-bindings.service";
import {
  dismissPromotionInvitation,
  listPromotionInvitations,
  listProviderTools,
  setProviderToolReplacement,
  type PromotionInvitation,
  type ProviderToolSummary,
} from "@/services/provider-tools.service";
import { toast } from "@/utils/toast";

/**
 * Your own APIs — route `/provider/apis` (design spec §7.6, §7.10).
 *
 * Tools only you serve, named under your public name (`acme__search_posts`),
 * each with its state: Draft, Only my team, Anyone with the link ("Not
 * reviewed"), In review, Listed, Changes requested, Taken down, Deprecated.
 * Above the list, Assay's invitations to serve a standard tool drafted from
 * one of yours: one click starts that listing prefilled with your endpoint.
 */

const PROVIDER_TOOLS_KEY = providerToolKeys.all;
const INVITATIONS_KEY = providerToolKeys.invitations;

function ToolRow({ tool }: { tool: ProviderToolSummary }) {
  const state = providerToolState(tool);
  return (
    <li className="border-t border-01 first:border-t-0">
      <Link href={routes.providerApi(tool.id)} className="flex flex-col gap-1.5 px-4 py-3.5 hover:bg-02 focus-visible:bg-02 focus-visible:outline-none tablet:flex-row tablet:items-center tablet:gap-4">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="break-all font-mono text-mono-13 font-semibold text-01">{tool.name}</span>
          <span className="text-body-xs text-03">
            {tool.currentSemver ? `v${tool.currentSemver}` : "No version published"} · {tool.category} · changed <UtcTime value={tool.updatedAt} midSentence />
          </span>
          {state.id === "CHANGES_REQUESTED" && tool.review.note ? (
            <span className="text-body-13 text-warning-700 [overflow-wrap:anywhere]">Reviewer: {tool.review.note}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 tablet:justify-end">
          <ProviderToolChips tool={tool} />
          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-03" />
        </span>
      </Link>
    </li>
  );
}

function InvitationCard({ invitation }: { invitation: PromotionInvitation }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: PROVIDER_TOOLS_KEY });
  };
  const start = useMutation({
    mutationFn: async () => {
      const prefill = invitation.prefill!;
      return createToolBinding({
        toolId: invitation.standardToolId,
        endpoint: prefill.endpoint,
        requestMapping: prefill.requestMapping,
        responseMapping: prefill.responseMapping,
        pricingMode: prefill.pricingMode as "FREE" | "FREEMIUM" | "PAID",
        priceAmount: prefill.priceAmount,
        assetId: prefill.assetId,
        settlementChains: prefill.settlementChains,
        slaFailureRate: DEFAULT_SLA_FAILURE_RATE,
        timeoutMs: prefill.timeoutMs,
      });
    },
    onSuccess: (binding) => {
      toast.success(`Listing of ${invitation.standardToolName} started from your endpoint. Run a test to continue.`);
      refresh();
      router.push(routes.bindingWizard(binding.id, "connect"));
    },
    onError: (error) => toast.error(error instanceof ApiError ? plainError(error.code) : "The listing could not be started. Try again."),
  });
  const point = useMutation({
    mutationFn: () => setProviderToolReplacement(invitation.sourceToolId, invitation.standardToolId),
    onSuccess: () => {
      toast.success(`${invitation.sourceToolName} now points agents to ${invitation.standardToolName}`);
      refresh();
    },
    onError: (error) => toast.error(error instanceof ApiError ? plainError(error.code) : "That did not work. Try again."),
  });
  const dismiss = useMutation({
    mutationFn: () => dismissPromotionInvitation(invitation.standardToolId, invitation.sourceToolId),
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof ApiError ? plainError(error.code) : "It could not be dismissed. Try again."),
  });
  const drafting = invitation.standardToolStatus === "DRAFT";
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-primary-20 bg-primary-10 px-4 py-3.5" data-testid="promotion-invitation">
      <div className="flex items-start gap-2.5">
        <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-700" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-label-sm text-01 [overflow-wrap:anywhere]">
            Assay made a standard tool from your <span className="font-mono text-mono-13">{invitation.sourceToolName}</span>:{" "}
            <span className="font-mono text-mono-13">{invitation.standardToolName}</span>
          </p>
          <p className="text-body-13 text-02">
            {drafting
              ? "It is still being written. When it is published, other providers can serve it too, and agents get a backup provider."
              : invitation.bound
                ? "You already serve it. Point agents of your own tool to it, so they move to the tool with backups."
                : "Serve it with the same endpoint: your listing starts prefilled with your endpoint, mappings and price. Then point agents of your own tool to it."}
          </p>
          <p className="text-body-xs text-03">
            Invited <UtcTime value={invitation.invitedAt} midSentence />
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!invitation.bound && invitation.prefill ? (
          <Button loading={start.isPending} disabled={drafting} onClick={() => start.mutate()}>
            Start the listing
          </Button>
        ) : null}
        {invitation.bound ? (
          <Button loading={point.isPending} onClick={() => point.mutate()}>
            Point agents to {invitation.standardToolName}
          </Button>
        ) : null}
        <Button variant="ghost" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>
          Not now
        </Button>
      </div>
    </li>
  );
}

export default function ProviderApisPage() {
  const listQuery = useInfiniteQuery({
    queryKey: providerToolKeys.list,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listProviderTools({ cursor: pageParam }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    retry: 0,
  });
  const invitations = useQuery({ queryKey: INVITATIONS_KEY, queryFn: listPromotionInvitations, retry: 0 });
  const items = React.useMemo(() => (listQuery.data?.pages ?? []).flatMap((page) => page.items), [listQuery.data]);
  const pendingInvites = invitations.data?.invitations ?? [];

  return (
    <>
      <SectionTabs tabs={PROVIDER_TOOLS_TABS} label="Tools" />
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Your own APIs</h1>
          <p className="text-body-13 text-03">
            An API no standard tool covers, published under your public name. Only you serve it, so it has no backup provider.
          </p>
        </div>
        <Button asChild>
          <Link href="/provider/apis/new">
            <Plus aria-hidden="true" />
            Publish your own API
          </Link>
        </Button>
      </header>

      {pendingInvites.length > 0 ? (
        <section aria-label="Invitations from Assay" className="flex w-full flex-col gap-2">
          <ul className="flex w-full flex-col gap-2">
            {pendingInvites.map((invitation) => (
              <InvitationCard key={`${invitation.standardToolId}:${invitation.sourceToolId}`} invitation={invitation} />
            ))}
          </ul>
        </section>
      ) : null}

      {listQuery.isPending ? (
        <PageState kind="loading" rows={4} label="Loading your APIs" />
      ) : listQuery.isError ? (
        <PageState
          kind="error"
          description={
            listQuery.error instanceof ApiError && listQuery.error.status === 403
              ? "Sign in as a person (not with an agent key) to manage your own APIs."
              : "Your APIs could not be loaded."
          }
          onRetry={() => void listQuery.refetch()}
          code={listQuery.error instanceof ApiError ? listQuery.error.code : null}
        />
      ) : items.length === 0 ? (
        <PageState
          kind="empty"
          title="No APIs of your own yet"
          description="Name it, describe what agents send and get back, connect your endpoint, then choose who can use it. Four steps; your progress is saved."
          action={{ label: "Publish your own API", href: "/provider/apis/new" }}
        />
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-lg border border-01 bg-01" data-testid="own-api-list">
          {items.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </ul>
      )}

      {listQuery.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={listQuery.isFetchingNextPage} onClick={() => void listQuery.fetchNextPage()}>
          Show more
        </Button>
      ) : null}
    </>
  );
}
