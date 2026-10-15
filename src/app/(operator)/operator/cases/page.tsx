"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DisputeLine } from "@/features/operator/dispute-line";
import { sortDisputesByDaysLeft } from "@/features/operator/inbox";
import { filterRecent, readRecentPenalties, type RecentPenalty } from "@/features/operator/recent-penalties";
import { capabilitiesFor } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { useProviderNames } from "@/features/operator/use-operator-lookups";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { listAdjudicationQueue, listArbiterDisputes } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

/**
 * Penalties, route `/operator/cases`.
 *
 * What the backend can list today: penalties disputed on chain (fewest days
 * left first), and any case still sitting in the retired off-chain queue.
 * A penalty nobody disputed has no list endpoint yet [backend: open penalties
 * by provider]. Until then there are two honest ways to one: the penalties
 * this browser opened lately, and its link (from the provider's ticket or
 * alert, or from Activity). One box filters both lists by provider.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

  const allRows = React.useMemo(() => sortDisputesByDaysLeft(disputes.data ?? []), [disputes.data]);
  const q = providerFilter.trim().toLowerCase();
  const rows = q ? allRows.filter((row) => providers.name(row.providerId).toLowerCase().includes(q)) : allRows;
  const disputedIds = new Set(allRows.map((row) => row.proposalId));
  const recentShown = filterRecent(recent, providerFilter).filter((item) => !disputedIds.has(item.id));
  const legacyRows = (legacy.data?.pages ?? []).flatMap((page) => page.items);

  const open = (event: React.FormEvent) => {
    event.preventDefault();
    // Accepts a bare id or any link that carries one.
    const id = UUID_RE.exec(lookup.trim())?.[0];
    if (!id) {
      setLookupError("Paste the penalty's id or its link.");
      return;
    }
    setLookupError(undefined);
    router.push(routes.operatorCase(id.toLowerCase()));
  };

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Penalties</h1>
        <p className="text-body-13 text-03">
          Penalties disputed on chain, fewest days left first. The arbiter has 30 days to rule; from day 20 they are red.
        </p>
      </header>

      <Field
        label="Provider"
        value={providerFilter}
        onChange={(e) => setProviderFilter(e.target.value)}
        placeholder="Type a provider's name to narrow both lists"
        autoComplete="off"
        wrapperClassName="tablet:max-w-[480px]"
      />

      <form onSubmit={open} className="flex w-full flex-col gap-2 tablet:flex-row tablet:items-start" noValidate>
        <Field
          label="Open a penalty"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          placeholder="Paste a penalty id or link"
          autoComplete="off"
          spellCheck={false}
          error={lookupError}
          wrapperClassName="tablet:max-w-[480px]"
        />
        <Button type="submit" variant="secondary" className="tablet:mt-[26px]">
          Open
        </Button>
      </form>

      <section aria-labelledby="disputed" className="flex w-full flex-col gap-2.5">
        <h2 id="disputed" className="text-label-md text-01">
          Disputed on chain{rows.length > 0 ? ` · ${rows.length}` : ""}
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
        ) : rows.length === 0 ? (
          <PageState
            kind="empty"
            title={q ? "No disputed penalty for this provider" : "No penalty is disputed"}
            description={q ? "Check the name, or look under Opened recently below." : "When a provider disputes a penalty on chain, it appears here with its 30-day limit."}
          />
        ) : (
          rows.map((row) => <DisputeLine key={row.requestId} row={row} providerName={providers.name(row.providerId)} now={now} canRule={caps.rule} />)
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

      <section aria-labelledby="recent" className="flex w-full flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="recent" className="text-label-md text-01">
            Opened recently in this browser{recentShown.length > 0 ? ` · ${recentShown.length}` : ""}
          </h2>
          <p className="text-body-xs text-03">
            Penalties nobody disputed have no list yet. To find one: open it from the provider&rsquo;s ticket or alert link, or from{" "}
            <Link href="/operator/override-log?kind=penalties" className="text-primary-600 hover:underline">
              Activity
            </Link>
            ; once opened, it stays here.
          </p>
        </div>
        {recentShown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-02 px-3.5 py-2.5 text-body-13 text-03">
            {q ? "None opened here for this provider." : "No penalty opened in this browser yet."}
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
