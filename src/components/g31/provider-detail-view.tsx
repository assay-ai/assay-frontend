"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Minus } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { ApiError } from "@/libs/ApiClient";
import { getCatalogueProvider } from "@/services/catalogue.service";
import { getProviderVerification } from "@/services/explore.service";
import { formatMoney, notCharged } from "@/utils/money";
import { presentVerdict } from "@/utils/verdict";

import { initialsOf, KeyValueRow, MicroLabel, StatCard, StatusPill } from "./chrome";
import { formatPrice, timestamp } from "./format";
import { useCatalogue } from "./use-catalogue";
import { shortToolId, useToolNames } from "./use-tool-names";

/**
 * Provider detail.
 *
 * **Availability and quality are two different quantities and are never
 * merged.** Availability is 1 − the SYSTEM_ERROR rate: whether the upstream
 * answered at all. Quality is the share of answers that passed our checks.
 * A provider can be perfectly available and consistently wrong, or flawless
 * and frequently down, and a single blended "score" would hide exactly the
 * distinction a buyer is here to make. The design says the same thing in its
 * own words under the sparkline — two dips that were "availability, not
 * quality — you were not charged for either" — so the two live in separate
 * tiles with separate captions.
 *
 * The "Who is behind this" rail carries what a buyer needs to be able to
 * read before spending: upstream, the operating provider, region,
 * data licence, 72h body retention, stake and slash history.
 *
 * Almost all of those have no endpoint. `GET /providers/{id}/verification`
 * returns exactly `{ providerId, legalName, verification }` — identity and
 * nothing else. Upstream, region, licence, retention, stake and slash history
 * are self-only (`/providers/me/*`) or absent entirely. Each row is therefore
 * present, named and explicitly unanswered, because a buyer who cannot see
 * these should be told they are missing rather than shown a plausible blank.
 *
 * Body retention is the one exception: 72h is a platform-wide constant the
 * design states, not a per-provider fact, so it is rendered as written.
 */

/**
 * The "serves N tools" clause, from the provider's own catalogue entry — the
 * same `toolIds` the list card counts. Unknown while that entry is loading or
 * failed, rather than a "0" that contradicts the card (BUG-R16-B3-02). Zero is
 * real: a provider who paused every binding still has a page.
 */
export function servedToolsLine(toolIds: readonly string[] | undefined): string {
  if (toolIds === undefined) return "tools served not known";
  if (toolIds.length === 0) return "serves no tool right now";
  return `serves ${toolIds.length} ${toolIds.length === 1 ? "tool" : "tools"} right now`;
}

export function ProviderDetailView({ providerId }: { providerId: string }) {
  const identity = useQuery({
    queryKey: ["provider-verification", providerId],
    retry: false,
    queryFn: () => getProviderVerification(providerId),
  });

  const { calls } = useCatalogue();
  const { nameOf } = useToolNames();

  /**
   * The provider's own catalogue entry, rather than a lookup into the list.
   *
   * The list only carries providers with an ACTIVE binding; this page must also
   * render for one who has paused everything since serving you, which is how a
   * buyer arrives here from a call record. `GET /catalogue/providers/{id}`
   * answers for both and 404s only when there is no provider at all.
   */
  const entry = useQuery({
    queryKey: ["catalogue", "provider", providerId],
    retry: false,
    staleTime: 60 * 1000,
    queryFn: () => getCatalogueProvider(providerId),
  });

  const row = entry.data ?? null;

  const own = React.useMemo(
    () => calls.filter((c) => c.providerId === providerId),
    [calls, providerId]
  );

  const totals = React.useMemo(() => {
    let listed = null as null | { amount: string; asset: string; decimals: number };
    let charged = null as null | { amount: string; asset: string; decimals: number };
    let systemErrors = 0;
    for (const call of own) {
      listed = listed
        ? { ...listed, amount: String(BigInt(listed.amount) + BigInt(call.price.amount)) }
        : call.price;
      charged = charged
        ? { ...charged, amount: String(BigInt(charged.amount) + BigInt(call.charged.amount)) }
        : call.charged;
      // The API has no SYSTEM_ERROR verdict on a tool call; VOIDED and EXPIRED
      // are the only statuses that stand in for "the upstream did not answer".
      if (call.status === "VOIDED" || call.status === "EXPIRED") systemErrors += 1;
    }
    return { listed, charged, systemErrors };
  }, [own]);

  const availability = own.length > 0 ? 1 - totals.systemErrors / own.length : null;

  if (identity.isPending) {
    return (
      <div className="px-4 py-5 tablet:px-7 tablet:py-[18px]">
        <p className="font-mono text-mono-13 text-03">Loading provider…</p>
      </div>
    );
  }

  if (identity.isError || !identity.data) {
    return (
      <div className="px-4 py-5 tablet:px-7 tablet:py-[18px]">
        <EmptyState
          title="No provider under that id"
          description={
            identity.error instanceof ApiError
              ? identity.error.message
              : "The request could not be completed."
          }
        />
      </div>
    );
  }

  const name = identity.data.legalName ?? providerId;
  const verification = identity.data.verification;

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-4 tablet:gap-4 tablet:px-7 tablet:py-[18px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2">
        <Link href="/explore/providers" className="text-body-13 text-03 hover:text-01">
          Explore
        </Link>
        <ChevronRight aria-hidden="true" className="size-3 text-03" />
        <Link href="/explore/providers" className="text-body-13 text-03 hover:text-01">
          Providers
        </Link>
        <ChevronRight aria-hidden="true" className="size-3 text-03" />
        <span className="truncate text-body-13 text-01">{name}</span>
      </nav>

      <div className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-5 py-5 tablet:flex-row tablet:items-center tablet:gap-5 tablet:px-6">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary-10 font-mono text-heading-md text-primary-600">
          {initialsOf(name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-heading-lg text-01">{name}</h1>
            {verification.verified ? (
              <StatusPill label="VERIFIED" tone="primary" />
            ) : (
              <StatusPill label="NOT VERIFIED" tone="neutral" />
            )}
          </div>
          <p className="text-body-md text-02">
            {verification.verified
              ? `Identity checked${verification.verifiedBy ? ` by ${verification.verifiedBy}` : ""}${verification.verifiedAt ? ` on ${timestamp(verification.verifiedAt)}` : ""}. The label says who you are buying from, not whether they are any good — quality does that.`
              : "Nobody has checked this provider's identity. That is not a judgement about their answers: an unverified provider still stakes, and still loses part of that stake when a response fails our checks."}
          </p>
        </div>
      </div>

      {/* Availability sits beside quality, never inside it. */}
      <div className="flex w-full flex-col gap-3 tablet:flex-row">
        <StatCard
          label="Quality"
          tone="teal"
          value={row?.quality == null ? "not measured" : `${(row.quality.rate * 100).toFixed(1)}%`}
          sub={
            row?.quality
              ? `${row.quality.measuredCalls.toLocaleString()} calls measured across the platform — the share that passed our checks`
              : "no call to this provider has closed a window yet"
          }
        />
        <StatCard
          label="Availability"
          value={availability == null ? "—" : `${(availability * 100).toFixed(2)}%`}
          sub="whether the upstream answered at all — a different question from quality"
        />
        <StatCard
          label="Calls"
          value={own.length}
          sub={`yours · ${servedToolsLine(row?.toolIds)}`}
        />
        <StatCard
          label="Not charged"
          tone="teal"
          value={
            totals.listed && totals.charged
              ? formatMoney(notCharged(totals.listed, totals.charged), { decimals: 4 })
              : "—"
          }
          sub="calls that failed our checks — you were not charged, and part of each penalty came back to you"
        />
        <StatCard
          label="From"
          value={formatPrice(row?.fromPrice ?? null)}
          sub={row && row.toolIds.length === 0 ? "nothing served right now" : "per call, cheapest tool it serves now"}
        />
      </div>

      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-start">
        {/* Tools this provider served. */}
        <Panel className="min-w-0 flex-1">
          <PanelHeader className="bg-02">
            <PanelTitles>
              <PanelTitle>Your calls</PanelTitle>
              <PanelDescription className="whitespace-normal">
                what this provider has served to this account, including tools it no longer
                serves
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody>
            {own.length === 0 ? (
              <p className="p-5 text-body-13 text-02">No call from this provider yet.</p>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-01 bg-02 px-[18px] py-3">
                  <div className="min-w-0 flex-1">
                    <MicroLabel>Call</MicroLabel>
                  </div>
                  <div className="w-[110px] text-right">
                    <MicroLabel>Listed</MicroLabel>
                  </div>
                  <div className="w-[110px] text-right">
                    <MicroLabel>Charged</MicroLabel>
                  </div>
                  <div className="w-[110px] text-right">
                    <MicroLabel>Status</MicroLabel>
                  </div>
                </div>
                {own.map((call) => (
                  <div
                    key={call.intentId}
                    className="flex items-center gap-3 border-b border-01 px-[18px] py-3 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-mono text-mono-13 font-semibold text-01">
                        {nameOf(call.toolId)}
                      </span>
                      <span className="truncate text-body-xs text-03" title={call.toolId}>
                        {shortToolId(call.toolId)} · {presentVerdict(call.verdict).shownAs}
                      </span>
                    </div>
                    <div className="w-[110px] text-right font-mono text-mono-12 text-01">
                      {formatMoney(call.price, { decimals: 4 })}
                    </div>
                    <div className="w-[110px] text-right font-mono text-mono-12 text-01">
                      {formatMoney(call.charged, { decimals: 4 })}
                    </div>
                    <div className="w-[110px] text-right font-mono text-mono-12 text-02">
                      {call.status}
                    </div>
                  </div>
                ))}
              </>
            )}
          </PanelBody>
        </Panel>

        <div className="flex w-full flex-col gap-4 tablet:w-[400px] tablet:shrink-0">
          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Who is behind this</PanelTitle>
                <PanelDescription className="whitespace-normal">
                  named, so you know where the data comes from
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-[18px] pb-3.5 pt-1">
              <KeyValueRow label="Upstream" value="not published" valueClassName="text-03" />
              <KeyValueRow label="Provider" value={name} />
              <KeyValueRow label="Region" value="not published" valueClassName="text-03" />
              <KeyValueRow label="Data licence" value="not published" valueClassName="text-03" />
              <KeyValueRow label="Body retention" value="72h" />
              <KeyValueRow label="Stake" value="not published" valueClassName="text-03" />
              <KeyValueRow
                label="Failed verifications"
                value="slashed from the provider's stake"
                valueClassName="text-teal-600"
              />
              <KeyValueRow
                label="Slash history"
                value="not published"
                valueClassName="text-03"
                divider={false}
              />
              <p className="pt-2 text-body-xs text-03">
                Upstream, region, licence, stake and penalty history are not published for other
                providers yet.
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>What we check on this provider</PanelTitle>
                <PanelDescription className="whitespace-normal">
                  published before you spend anything
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-[18px] pb-3.5 pt-1.5">
              {verification.checks.length === 0 ? (
                <p className="py-2 text-body-13 text-02">
                  No identity check has been recorded for this provider. The response-shape and
                  result-quality checks below still run on every paid call regardless.
                </p>
              ) : (
                verification.checks.map((check) => (
                  <div key={check.check} className="flex w-full gap-2.5 py-2.5">
                    {check.result === "PASS" ? (
                      <Check aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-success-500" />
                    ) : (
                      <Minus aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-03" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-label-13 text-01">{check.check}</span>
                      {check.note ? (
                        <span className="text-body-xs text-03">{check.note}</span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              <div className="flex w-full gap-2.5 py-2.5">
                <Check aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-success-500" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label-13 text-01">Response shape</span>
                  <span className="text-body-xs text-03">runs on every call</span>
                </div>
              </div>
              <div className="flex w-full gap-2.5 py-2.5">
                <Check aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-success-500" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label-13 text-01">Result quality rules</span>
                  <span className="text-body-xs text-03">
                    freshness, required fields, value plausibility
                  </span>
                </div>
              </div>
              <div className="flex w-full gap-2.5 py-2.5">
                <Minus aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-03" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label-13 text-01">Relevance judgement</span>
                  <span className="text-body-xs text-03">
                    sampled — the rate is set per binding and published on the receipt
                  </span>
                </div>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
