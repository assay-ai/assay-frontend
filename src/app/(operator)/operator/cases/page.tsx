"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { penaltyPhrase } from "@/features/operator/approvals";
import { disputeAmount } from "@/features/operator/arbiter";
import { DisputeLine } from "@/features/operator/dispute-line";
import { sortDisputesByDaysLeft } from "@/features/operator/inbox";
import {
  KNOWN_SOURCE_TEXT,
  knownPenalties,
  penaltyIdFrom,
  readRecentPenalties,
  type KnownPenalty,
  type RecentPenalty,
} from "@/features/operator/recent-penalties";
import { capabilitiesFor } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { usePenaltyBriefs, useProviderNames } from "@/features/operator/use-operator-lookups";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listAdjudicationQueue, listArbiterDisputes, listOverrideLog } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

/**
 * Penalties, route `/operator/cases`.
 *
 * Finding a penalty comes first (support and on-call arrive with a provider
 * name or a link, not a list position). No endpoint lists every penalty
 * [backend: open penalties by provider], so "Search by provider" searches
 * every list that does exist — disputed on chain, acted on by an operator
 * (Activity's penalty entries) and opened in this browser — and says plainly
 * that an untouched, undisputed penalty is reached by its link.
 */

/** Activity entries read for penalties acted on; their penalties are read whole to name them. */
const ACTIVITY_LOOKBACK = 50;
/** One shown in the paste box's hint, so the shape of an id is obvious. */
const EXAMPLE_ID = "8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18";

export default function PenaltiesPage() {
  const me = useOperatorSession();
  const caps = capabilitiesFor(me.roles);
  const router = useRouter();
  const providers = useProviderNames();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [lookup, setLookup] = React.useState("");
  const [lookupError, setLookupError] = React.useState<string | undefined>(undefined);
  const [providerFilter, setProviderFilter] = React.useState("");
  const [recent, setRecent] = React.useState<RecentPenalty[]>([]);
  React.useEffect(() => setRecent(readRecentPenalties()), []);

  const disputes = useQuery({
    queryKey: ["operator", "arbiter", "disputes"],
    queryFn: listArbiterDisputes,
    refetchInterval: 60_000,
    retry: 0,
  });
  const legacy = useInfiniteQuery({
    queryKey: ["operator", "queue", "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listAdjudicationQueue({ limit: 25, cursor: pageParam }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const activity = useQuery({
    queryKey: ["operator", "override-log", "penalties-acted-on"],
    queryFn: () => listOverrideLog({ targetType: "slash_proposal", limit: ACTIVITY_LOOKBACK }),
    staleTime: 60_000,
    retry: 0,
  });
  const actedIds = React.useMemo(() => [...new Set((activity.data?.items ?? []).map((row) => row.targetId))], [activity.data]);
  const actedBriefs = usePenaltyBriefs(actedIds);

  const allRows = React.useMemo(() => sortDisputesByDaysLeft(disputes.data ?? []), [disputes.data]);
  const q = providerFilter.trim();
  const disputedIds = new Set(allRows.map((row) => row.proposalId));
  const legacyRows = (legacy.data?.pages ?? []).flatMap((page) => page.items);

  const disputedKnown: KnownPenalty[] = allRows.map((row) => {
    const money = disputeAmount(row.chainId, row.penaltyAmount);
    const name = providers.name(row.providerId);
    return { id: row.proposalId, providerId: row.providerId, label: money ? penaltyPhrase(name, formatMoney(money)) : `${name}'s penalty`, source: "disputed" };
  });
  const actedKnown: KnownPenalty[] = actedIds.flatMap((id) => {
    const brief = actedBriefs.get(id);
    if (!brief) return [];
    const proposal = brief.case.proposal;
    return [{ id, providerId: proposal.providerId, label: penaltyPhrase(providers.name(proposal.providerId), formatMoney(proposal.penaltyAmount)), source: "activity" as const }];
  });
  const recentKnown: KnownPenalty[] = recent.map((item) => ({ ...item, source: "recent" as const }));
  const sources = { disputed: disputedKnown, activity: actedKnown, recent: recentKnown };
  const found = q ? knownPenalties(sources, providers.name, q) : [];
  const actedShown = knownPenalties({ disputed: [], activity: actedKnown, recent: [] }, providers.name, "").filter((item) => !disputedIds.has(item.id));
  const actedSet = new Set(actedShown.map((item) => item.id));
  const recentShown = recent.filter((item) => !disputedIds.has(item.id) && !actedSet.has(item.id));
  const searching = activity.isLoading || disputes.isLoading;

  const open = (event: React.FormEvent) => {
    event.preventDefault();
    const id = penaltyIdFrom(lookup);
    if (!id) {
      setLookupError("That has no penalty id in it. Paste the id, or the whole link.");
      return;
    }
    setLookupError(undefined);
    router.push(routes.operatorCase(id));
  };

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Penalties</h1>
        <p className="text-body-13 text-03">Find any penalty by its link or its provider, and see the ones disputed on chain.</p>
      </header>

      <section aria-labelledby="find" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4">
        <h2 id="find" className="text-label-md text-01">
          Find a penalty
        </h2>
        <form onSubmit={open} className="flex w-full flex-col gap-2 tablet:flex-row tablet:items-start" noValidate>
          <Field
            label="Its id or link"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="Paste an id or a link"
            autoComplete="off"
            spellCheck={false}
            error={lookupError}
            hint={
              <>
                From the provider&rsquo;s alert or ticket, or a penalty in Activity. For example{" "}
                <span className="break-all font-mono">{EXAMPLE_ID}</span>
              </>
            }
            wrapperClassName="tablet:max-w-[480px]"
          />
          <Button type="submit" className="tablet:mt-[26px]">
            Open
          </Button>
        </form>
        <Field
          label="Search by provider"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          placeholder="e.g. Northwind"
          autoComplete="off"
          wrapperClassName="tablet:max-w-[480px]"
        />
        {q ? (
          <div className="flex w-full flex-col gap-2" aria-live="polite">
            {found.length > 0 ? (
              <ul className="flex w-full flex-col rounded-lg border border-01">
                {found.map((item) => (
                  <li key={item.id} className="border-b border-01 last:border-b-0">
                    <Link
                      href={routes.operatorCase(item.id)}
                      className="flex w-full flex-col gap-0.5 px-3.5 py-2.5 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4"
                    >
                      <span className="min-w-0 flex-1 text-body-13 text-01">{item.label}</span>
                      <span className="text-body-xs text-03">{KNOWN_SOURCE_TEXT[item.source]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : searching ? (
              <PageState kind="loading" rows={2} label="Searching penalties" bare />
            ) : (
              <p className="rounded-lg border border-dashed border-02 px-3.5 py-2.5 text-body-13 text-03">
                No penalty of a provider matching &ldquo;{q}&rdquo; was disputed, acted on or opened here.
              </p>
            )}
            <p className="text-body-xs text-03">
              Searched: disputed on chain, acted on in{" "}
              <Link href="/operator/override-log?kind=penalties" className="text-primary-600 hover:underline">
                Activity
              </Link>
              , and opened in this browser. Assay has no list of every penalty yet, so one nobody disputed or acted on opens from its link above.
            </p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="disputed" className="flex w-full flex-col gap-2.5">
        <h2 id="disputed" className="text-label-md text-01">
          Disputed on chain{allRows.length > 0 ? ` · ${allRows.length}` : ""}
        </h2>
        {disputes.isLoading ? (
          <PageState kind="loading" rows={3} label="Loading disputed penalties" />
        ) : disputes.isError ? (
          <PageState
            kind="error"
            description="The disputed penalties could not be loaded."
            onRetry={() => void disputes.refetch()}
            code={disputes.error instanceof ApiError ? disputes.error.code : null}
          />
        ) : allRows.length === 0 ? (
          <PageState
            kind="empty"
            title="No penalty is disputed"
            description="When a provider disputes a penalty on chain, it appears here with its 30-day limit."
          />
        ) : (
          allRows.map((row) => <DisputeLine key={row.requestId} row={row} providerName={providers.name(row.providerId)} now={now} canRule={caps.rule} />)
        )}
      </section>

      {legacyRows.length > 0 ? (
        <section aria-labelledby="legacy" className="flex w-full flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h2 id="legacy" className="text-label-md text-01">
              From the retired objection process · {legacyRows.length}
            </h2>
            <p className="text-body-xs text-03">Objections filed before disputes moved on chain. Open one to see where its record stands.</p>
          </div>
          <ul className="flex w-full flex-col rounded-xl border border-01 bg-01">
            {legacyRows.map((row) => (
              <li key={row.proposalId} className="border-b border-01 last:border-b-0">
                <Link
                  href={routes.operatorCase(row.proposalId)}
                  className="flex w-full flex-col gap-0.5 px-4 py-3 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4"
                >
                  <span className="min-w-0 flex-1 text-body-13 text-01">{row.providerName}</span>
                  <span className="font-mono text-mono-13 text-01">{formatMoney(row.penaltyAmount)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {legacy.hasNextPage ? (
            <Button variant="secondary" className="self-start" loading={legacy.isFetchingNextPage} onClick={() => void legacy.fetchNextPage()}>
              Load more
            </Button>
          ) : null}
        </section>
      ) : null}

      {actedShown.length > 0 ? (
        <section aria-labelledby="acted" className="flex w-full flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h2 id="acted" className="text-label-md text-01">
              Acted on lately · {actedShown.length}
            </h2>
            <p className="text-body-xs text-03">Penalties an operator suspended, ruled on or compensated, from Activity.</p>
          </div>
          <ul className="flex w-full flex-col rounded-xl border border-01 bg-01">
            {actedShown.map((item) => (
              <li key={item.id} className="border-b border-01 last:border-b-0">
                <Link
                  href={routes.operatorCase(item.id)}
                  className="flex w-full flex-col gap-0.5 px-4 py-3 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4"
                >
                  <span className="min-w-0 flex-1 text-body-13 text-01">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="recent" className="flex w-full flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="recent" className="text-label-md text-01">
            Opened recently in this browser{recentShown.length > 0 ? ` · ${recentShown.length}` : ""}
          </h2>
          <p className="text-body-xs text-03">A penalty you open from its link stays here, so you can come back to it.</p>
        </div>
        {recentShown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-02 px-3.5 py-2.5 text-body-13 text-03">
            No penalty opened in this browser yet.
          </p>
        ) : (
          <ul className="flex w-full flex-col rounded-xl border border-01 bg-01">
            {recentShown.map((item) => (
              <li key={item.id} className="border-b border-01 last:border-b-0">
                <Link
                  href={routes.operatorCase(item.id)}
                  className="flex w-full flex-col gap-0.5 px-4 py-3 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4"
                >
                  <span className="min-w-0 flex-1 text-body-13 text-01">{item.label}</span>
                  <span className="text-body-xs text-03">
                    opened <LocalTime value={item.at} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-body-xs text-03">Penalties waiting for a cancel signature show on their own page with the deadline.</p>
    </>
  );
}
