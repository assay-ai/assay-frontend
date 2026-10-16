"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { BindingHeader, useBinding } from "@/features/provider-binding/binding-header";
import { BuyerPreview } from "@/features/provider-binding/buyer-preview";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { recentWindows, slaReading, WINDOW_OUTCOME, windowRange, windowRate } from "@/features/provider-sla/reading";
import { AgentIdCell } from "@/features/provider-traffic/agent-id-cell";
import { verdictChip, verdictFilterStatuses, type VerdictFilter } from "@/features/provider-verdicts/present";
import type { SlaWindow, SlaWindowEvidence } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plain } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { listProviderVerdicts } from "@/services/provider-verdicts.service";
import { getSlaWindowEvidence, listSlaWindows } from "@/services/provider-sla-windows.service";
import { cn } from "@/utils";

/**
 * A listing's Quality tab — what used to be three pages (Live SLA, Verdicts,
 * Agent traffic) and the minimal-shell duplicates:
 *
 *   1. How you are doing against your promise this window, as a sentence
 *      ("1.6% of your 2% this window") with the early warning, and "Not
 *      enough calls yet (6 of 400)" instead of a red banner while no penalty
 *      is possible.
 *   2. Recent windows by their dates, as a small pass/fail strip.
 *   3. Who calls this tool and what failed, from the window's evidence.
 *   4. Every checked call (default All), failures in plain words.
 *   5. How buyers see the listing.
 */

const REFRESH_MS = 60_000;

const TONE_BOX = {
  ok: "border-success-500 bg-success-10 text-success-700",
  warning: "border-warning-500 bg-warning-10 text-warning-700",
  danger: "border-danger-500 bg-danger-10 text-danger-700",
  neutral: "border-01 bg-01 text-02",
} as const;

function WindowStrip({ windows, declared }: { windows: SlaWindow[]; declared: number }) {
  const ordered = [...windows].reverse();
  return (
    <ol className="flex w-full items-end gap-1" aria-label="Failure rate in recent windows, oldest first">
      {ordered.map((window) => {
        const rate = window.observedFailureRate ?? 0;
        const over = window.outcome === "BREACH_PROPOSED" || (window.verifiedCalls >= window.minVerifiedCalls && rate > declared);
        const height = Math.max(8, Math.min(48, declared > 0 ? (rate / declared) * 24 : 8));
        return (
          <li key={window.windowId} className="flex flex-1 flex-col items-center" title={`${windowRange(window)}: ${(rate * 100).toFixed(1)}%`}>
            <span
              className={cn("w-full max-w-6 rounded-sm", over ? "bg-danger-500" : window.verifiedCalls < window.minVerifiedCalls ? "bg-03" : "bg-success-500")}
              style={{ height }}
            />
            <span className="sr-only">{`${windowRange(window)}: ${(rate * 100).toFixed(1)}% failures${over ? ", over your promise" : ""}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Agents({ evidence }: { evidence: SlaWindowEvidence }) {
  const rows = React.useMemo(() => {
    const byAgent = new Map<string, { calls: number; failures: number }>();
    for (const call of evidence.calls) {
      const row = byAgent.get(call.agentId) ?? { calls: 0, failures: 0 };
      row.calls += 1;
      if (call.countedAsFailure) row.failures += 1;
      byAgent.set(call.agentId, row);
    }
    return [...byAgent.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, 8);
  }, [evidence]);
  if (rows.length === 0) return <p className="text-body-13 text-03">No calls in this window yet.</p>;
  return (
    <ul className="flex w-full flex-col">
      {rows.map(([agentId, row]) => (
        <li key={agentId} className="flex items-center justify-between gap-3 border-t border-01 py-2.5 first:border-t-0">
          <AgentIdCell agentId={agentId} className="text-body-13 text-01" />
          <span className="text-body-13 text-02">
            {row.calls.toLocaleString("en-US")} call{row.calls === 1 ? "" : "s"}
            {row.failures > 0 ? <span className="text-danger-600">{` · ${row.failures} failed`}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function QualityContent() {
  const params = useSearchParams();
  const bindingId = params.get("binding") ?? "";
  const names = useProviderToolNames();
  const bindingQuery = useBinding(bindingId);
  const binding = bindingQuery.data;

  const windowsQuery = useQuery({
    queryKey: ["provider", "sla-windows", "quality", bindingId],
    queryFn: () => listSlaWindows({ bindingId, limit: 12 }),
    enabled: Boolean(bindingId),
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const windows = React.useMemo(() => recentWindows(windowsQuery.data?.items ?? [], bindingId), [windowsQuery.data, bindingId]);
  const current = windows.find((window) => window.status === "OPEN") ?? windows[0] ?? null;

  const evidenceQuery = useQuery({
    queryKey: ["provider", "sla-window-evidence", current?.windowId],
    queryFn: () => getSlaWindowEvidence(current!.windowId),
    enabled: current !== null,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const evidence = evidenceQuery.data;

  const [filter, setFilter] = React.useState<VerdictFilter>("all");
  const [scope, setScope] = React.useState<"window" | "all">("window");
  const windowId = scope === "window" ? current?.windowId : undefined;
  const verdicts = useInfiniteQuery({
    queryKey: ["provider", "verdicts", bindingId, filter, windowId ?? "all"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listProviderVerdicts({ limit: 25, cursor: pageParam, verdictStatus: verdictFilterStatuses(filter), windowId }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    enabled: windowsQuery.isFetched,
    retry: 0,
  });
  const verdictItems = React.useMemo(
    () =>
      (verdicts.data?.pages ?? [])
        .flatMap((page) => page.items)
        // The feed is per provider; a window already scopes it to this tool, "all" does not.
        .filter((item) => !binding || item.toolId === binding.toolId),
    [verdicts.data, binding],
  );

  React.useEffect(() => {
    if (params.get("section") === "verdicts") document.getElementById("quality-verdicts")?.scrollIntoView({ block: "start" });
  }, [params]);

  if (bindingQuery.isError) {
    return (
      <PageState
        kind="error"
        title="This listing could not be opened"
        onRetry={() => void bindingQuery.refetch()}
        code={bindingQuery.error instanceof ApiError ? bindingQuery.error.code : null}
      />
    );
  }

  const declared = binding?.slaFailureRate ?? current?.declaredFailureRate ?? 0;
  const reading = slaReading(current, binding?.slaFailureRate ?? null);
  const tool = binding ? names.tool(binding.toolId) : null;

  return (
    <>
      <BindingHeader bindingId={bindingId} binding={binding} active="quality" />

      {!binding || windowsQuery.isPending ? (
        <PageState kind="loading" rows={5} label="Loading quality" />
      ) : binding.status === "DRAFT" ? (
        <PageState
          kind="empty"
          title="No calls yet"
          description="Quality is measured once your tool is live and agents call it."
          action={{ label: "Continue setup", href: routes.bindingWizard(binding.id) }}
        />
      ) : (
        <>
          <section
            aria-live="polite"
            className={cn("flex w-full flex-col gap-1.5 rounded-lg border px-4 py-3.5", TONE_BOX[reading.tone])}
          >
            <span className="text-label-md">
              {reading.headline ?? (current ? "No checked calls yet" : "No calls yet")}
            </span>
            {reading.sample ? <span className="text-label-13">{reading.sample}</span> : null}
            <span className="text-body-13">{reading.advice}</span>
            {current && current.status !== "OPEN" ? (
              <span className="text-body-xs opacity-80">{windowRange(current)}</span>
            ) : current ? (
              <span className="text-body-xs opacity-80">
                This window closes by <UtcTime value={current.deadlineAt} />, or sooner once enough calls are checked.
              </span>
            ) : null}
          </section>

          <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
            <Panel className="w-full min-w-0 flex-1">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Recent windows</PanelTitle>
                  <PanelDescription>Green kept the promise, grey had too few calls, red went over</PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
                {windows.length === 0 ? (
                  <p className="text-body-13 text-03">The first window opens with the first call.</p>
                ) : (
                  <>
                    <WindowStrip windows={windows} declared={declared} />
                    <ul className="flex w-full flex-col">
                      {windows.slice(0, 5).map((window) => (
                        <li key={window.windowId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-01 py-2.5 first:border-t-0">
                          <span className="text-body-13 text-01">{windowRange(window)}</span>
                          <span className={cn("text-body-xs", window.outcome === "BREACH_PROPOSED" ? "text-danger-600" : "text-02")}>
                            {[
                              window.status === "OPEN" ? "Open now" : window.outcome ? WINDOW_OUTCOME[window.outcome] : "Closed",
                              windowRate(window) ? `${windowRate(window)} failed` : null,
                              `${window.verifiedCalls.toLocaleString("en-US")} checked call${window.verifiedCalls === 1 ? "" : "s"}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </PanelBody>
            </Panel>

            <Panel className="w-full tablet:w-[380px] tablet:shrink-0">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Who calls this tool</PanelTitle>
                  <PanelDescription>This window, most calls first</PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
                {evidence ? <Agents evidence={evidence} /> : <p className="text-body-13 text-03">No calls in this window yet.</p>}
                {evidence && evidence.failuresByReasonCode.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-label-13 text-01">What failed</span>
                    <ul className="flex flex-col gap-1">
                      {evidence.failuresByReasonCode.map((group) => (
                        <li key={group.key} className="flex justify-between gap-3 text-body-13">
                          <span className="text-02">{plain(group.key)}</span>
                          <span className="font-mono text-danger-600">{group.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </PanelBody>
            </Panel>
          </section>

          <Panel className="w-full" id="quality-verdicts">
            <PanelHeader className="flex-wrap">
              <PanelTitles>
                <PanelTitle>Checked calls</PanelTitle>
                <PanelDescription>Each call we checked, and why a failed one failed</PanelDescription>
              </PanelTitles>
              <div className="flex flex-wrap gap-2">
                <Segmented value={filter} onValueChange={(value) => setFilter(value as VerdictFilter)} aria-label="Which calls">
                  <SegmentedItem value="all">All</SegmentedItem>
                  <SegmentedItem value="failed">Failed</SegmentedItem>
                  <SegmentedItem value="passed">Passed</SegmentedItem>
                </Segmented>
                {current ? (
                  <Segmented value={scope} onValueChange={(value) => setScope(value as "window" | "all")} aria-label="When">
                    <SegmentedItem value="window">This window</SegmentedItem>
                    <SegmentedItem value="all">All time</SegmentedItem>
                  </Segmented>
                ) : null}
              </div>
            </PanelHeader>
            <PanelBody className="p-4 tablet:p-5">
              {verdicts.isPending ? (
                <PageState kind="loading" rows={4} bare label="Loading checked calls" />
              ) : verdicts.isError ? (
                <PageState kind="error" bare description="Checked calls could not be loaded." onRetry={() => void verdicts.refetch()} />
              ) : verdictItems.length === 0 ? (
                <PageState
                  kind="empty"
                  bare
                  title={filter === "failed" ? "No failed calls" : "No checked calls yet"}
                  description={filter === "failed" ? "Nothing failed the check here." : "Calls appear here as agents use your tool."}
                />
              ) : (
                <ul className="flex w-full flex-col">
                  {verdictItems.map((item) => {
                    const chip = verdictChip(item.verdictStatus);
                    return (
                      <li key={item.id} className="border-t border-01 first:border-t-0">
                        <Link
                          href={routes.verdict(bindingId, item.id)}
                          className="flex flex-col gap-1 py-3 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4"
                        >
                          <span className="w-36 shrink-0 text-body-xs text-03">
                            <UtcTime value={item.createdAt} />
                          </span>
                          <span className={cn("w-fit shrink-0 rounded-full px-2 py-0.5 text-label-xs", chip.className)}>{chip.label}</span>
                          <span className="min-w-0 flex-1 truncate text-body-13 text-02">
                            {item.failingRules.length > 0
                              ? item.failingRules.map((rule) => plain(rule)).join("; ")
                              : item.reasonCode
                                ? plain(item.reasonCode)
                                : chip.note}
                          </span>
                          {item.callClass === "FREE" ? <span className="text-label-xs text-teal-600">Free call</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {verdicts.hasNextPage ? (
                <Button variant="secondary" className="mt-3" loading={verdicts.isFetchingNextPage} onClick={() => void verdicts.fetchNextPage()}>
                  Show more
                </Button>
              ) : null}
            </PanelBody>
          </Panel>

          <BuyerPreview
            toolName={names.bindingLabel(binding)}
            description={tool?.description ?? null}
            mode={binding.pricingMode}
            price={binding.price}
            freeCalls={binding.freeQuotaPerAgent}
            failureRate={binding.slaFailureRate}
          />
        </>
      )}
    </>
  );
}

export default function BindingQualityPage() {
  return <QualityContent />;
}
