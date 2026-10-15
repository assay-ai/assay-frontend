"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, PartyPopper, Pause, Pencil, Play } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { StatusTimeline, type StatusTimelineStep } from "@/components/patterns/status-timeline";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { BindingHeader, bindingQueryKey, useBinding } from "@/features/provider-binding/binding-header";
import { BuyerPreview } from "@/features/provider-binding/buyer-preview";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { slaReading } from "@/features/provider-sla/reading";
import type { SlaWindow, ToolBindingDetail } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getPublishCheck, pauseToolBinding, resumeToolBinding } from "@/services/provider-tool-bindings.service";
import { getProviderEarnings } from "@/services/provider-reports.service";
import { listSlaWindows } from "@/services/provider-sla-windows.service";
import { cn } from "@/utils";
import { formatMoney, formatMoneyNonZero } from "@/utils/money";

/**
 * A listing's Overview: where it stands (one timeline), the one thing to do
 * next (one primary action), the numbers that exist (no "—" tiles), and its
 * terms at a glance. Right after publishing (`?welcome=1`) or until the first
 * call lands it shows the "Your tool is live" first-run card, which listens
 * for that first call.
 */

const REFRESH_MS = 60_000;
const LISTEN_MS = 10_000;

function lifecycle(binding: ToolBindingDetail, testPassed: boolean): StatusTimelineStep[] {
  const live = binding.status === "ACTIVE";
  const paused = binding.status === "PAUSED" || binding.status === "SUSPENDED";
  const published = binding.publishedVersion !== null;
  return [
    { id: "draft", label: "Draft", state: "done" },
    {
      id: "tested",
      label: "Tested",
      state: testPassed || published ? "done" : "current",
      description: testPassed || published ? undefined : "Run a passing test.",
    },
    {
      id: "live",
      label: "Live",
      state: live ? "current" : published ? "done" : "upcoming",
      description: live ? "Agents can call it." : undefined,
    },
    // Paused is a state the tool can be in, not a stage it moves towards: only show it when it applies.
    ...(paused
      ? [{ id: "paused", label: binding.status === "SUSPENDED" ? "Paused by Assay" : "Paused", state: "current" as const }]
      : []),
  ];
}

function Figure({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "warning" | "danger" | "ok" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-01 bg-01 p-4">
      <span className="text-body-xs text-03">{label}</span>
      <span
        className={cn(
          "font-mono text-mono-md font-semibold",
          tone === "danger" ? "text-danger-600" : tone === "warning" ? "text-warning-700" : "text-01",
        )}
      >
        {value}
      </span>
      {note ? <span className="text-body-xs text-02">{note}</span> : null}
    </div>
  );
}

function FirstRunCard({ binding, toolName, description }: { binding: ToolBindingDetail; toolName: string; description: string | null }) {
  // Listens for the first call: a window opens only once a call is served.
  const windows = useQuery({
    queryKey: ["provider", "sla-windows", "first-call", binding.id],
    queryFn: () => listSlaWindows({ bindingId: binding.id, limit: 1 }),
    refetchInterval: (query) => ((query.state.data?.items[0]?.totalCalls ?? 0) > 0 ? false : LISTEN_MS),
    retry: 0,
  });
  const first = windows.data?.items[0] ?? null;
  const gotCall = (first?.totalCalls ?? 0) > 0;
  const gotPaid = gotCall && first !== null && /[1-9]/.test(first.totalCallAmount ?? "0");

  return (
    <Panel className="w-full border-success-500">
      <PanelBody className="flex flex-col gap-4 p-4 tablet:flex-row tablet:p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <PartyPopper aria-hidden="true" className="size-5 text-success-600" />
            <h2 className="text-label-md text-01">Your tool is live</h2>
          </div>
          <p className="text-body-13 text-02">
            {toolName} is in the catalogue. Agents that need it can call it now; you are paid for each call that passes
            the check.
          </p>
          <ol className="flex flex-col gap-2" aria-live="polite">
            <li className="flex items-center gap-2 text-body-13 text-01">
              <span className="flex size-5 items-center justify-center rounded-full bg-success-500 text-on-color">✓</span>
              Published
            </li>
            <li className="flex items-center gap-2 text-body-13 text-01">
              {gotCall ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-success-500 text-on-color">✓</span>
              ) : (
                <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary-500" />
              )}
              {gotCall ? "First call received" : "Waiting for the first call… (we check every 10 seconds)"}
            </li>
            {binding.pricingMode !== "FREE" ? (
              <li className={cn("flex items-center gap-2 text-body-13", gotPaid ? "text-01" : "text-03")}>
                {gotPaid ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-success-500 text-on-color">✓</span>
                ) : (
                  <span className="size-5 rounded-full border border-02" />
                )}
                First paid call
              </li>
            ) : null}
          </ol>
          <p className="text-body-xs text-03">
            Next: watch quality in the Quality tab. You get an Inbox message if your failure rate gets close to your promise.
          </p>
        </div>
        <BuyerPreview
          className="w-full tablet:w-[360px] tablet:shrink-0"
          toolName={toolName}
          description={description}
          mode={binding.pricingMode}
          price={binding.price}
          freeCalls={binding.freeQuotaPerAgent}
          failureRate={binding.slaFailureRate}
        />
      </PanelBody>
    </Panel>
  );
}

function OverviewContent() {
  const params = useSearchParams();
  const bindingId = params.get("binding") ?? "";
  const welcome = params.get("welcome") === "1";
  const queryClient = useQueryClient();
  const names = useProviderToolNames();

  const bindingQuery = useBinding(bindingId, { refetchInterval: REFRESH_MS });
  const binding = bindingQuery.data;

  const check = useQuery({
    queryKey: ["provider", "tool-binding", bindingId, "publish-check"],
    queryFn: () => getPublishCheck(bindingId),
    enabled: binding?.status === "DRAFT",
    retry: 0,
  });
  const testPassed = (check.data?.requirements ?? []).some((r) => r.requirement === "TESTER_PASSED" && r.met);

  const windowsQuery = useQuery({
    queryKey: ["provider", "sla-windows", "latest", bindingId],
    queryFn: () => listSlaWindows({ bindingId, limit: 1 }),
    enabled: Boolean(bindingId) && binding?.status !== "DRAFT",
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const window: SlaWindow | null = windowsQuery.data?.items[0] ?? null;

  // Last 24 hours for this tool: calls and earnings. Times are fixed per minute so the key is stable.
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null);
  React.useEffect(() => {
    const to = Math.floor(Date.now() / 60_000) * 60_000;
    setRange({ from: new Date(to - 86_400_000).toISOString(), to: new Date(to).toISOString() });
  }, []);
  const earnings = useQuery({
    queryKey: ["provider", "earnings", "tool", range?.from, range?.to],
    queryFn: () => getProviderEarnings({ from: range!.from, to: range!.to, groupBy: "tool" }),
    enabled: Boolean(range) && binding?.status !== "DRAFT",
    retry: 0,
  });
  const group = binding ? earnings.data?.groups.find((entry) => entry.key === binding.toolId) : undefined;

  const apply = (updated: ToolBindingDetail) => {
    queryClient.setQueryData(bindingQueryKey(bindingId), updated);
    void queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings"] });
  };
  const [pauseOpen, setPauseOpen] = React.useState(false);
  const pause = useMutation({ mutationFn: () => pauseToolBinding(bindingId), onSuccess: apply });
  const resume = useMutation({ mutationFn: () => resumeToolBinding(bindingId), onSuccess: apply });

  if (!bindingId) {
    return <PageState kind="empty" title="No tool chosen" action={{ label: "See your tools", href: "/provider/bindings" }} />;
  }
  if (bindingQuery.isError) {
    return (
      <PageState
        kind="error"
        title="This listing could not be opened"
        description="It may have been removed, or it belongs to another account."
        onRetry={() => void bindingQuery.refetch()}
        code={bindingQuery.error instanceof ApiError ? bindingQuery.error.code : null}
      />
    );
  }

  const toolName = binding ? names.bindingLabel(binding) : "";
  const tool = binding ? names.tool(binding.toolId) : null;

  let primary: React.ReactNode = null;
  if (binding?.status === "DRAFT") {
    primary = (
      <Button asChild>
        <Link href={routes.bindingWizard(bindingId)}>
          Continue setup
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    );
  } else if (binding?.status === "ACTIVE") {
    primary = (
      <>
        <Button variant="secondary" icon={<Pause aria-hidden="true" />} onClick={() => setPauseOpen(true)}>
          Pause
        </Button>
        <Button asChild>
          <Link href={routes.binding(bindingId, "settings")}>
            <Pencil aria-hidden="true" />
            {binding.hasUnpublishedChanges ? "Review changes" : "Edit price"}
          </Link>
        </Button>
      </>
    );
  } else if (binding?.status === "PAUSED") {
    primary = (
      <Button icon={<Play aria-hidden="true" />} loading={resume.isPending} onClick={() => resume.mutate()}>
        Resume
      </Button>
    );
  }

  const reading = slaReading(window, binding?.slaFailureRate ?? null);
  const showFirstRun = binding?.status === "ACTIVE" && (welcome || (windowsQuery.isSuccess && window === null));

  return (
    <>
      <BindingHeader bindingId={bindingId} binding={binding} active="overview" actions={primary} />

      {resume.isError ? (
        <p role="alert" className="text-body-13 text-danger-600">
          {resume.error instanceof ApiError ? plainError(resume.error.code) : "It could not be resumed. Try again."}
        </p>
      ) : null}

      {!binding ? (
        <PageState kind="loading" rows={4} label="Loading this listing" />
      ) : (
        <>
          {binding.status === "SUSPENDED" ? (
            <p className="rounded-lg bg-warning-10 px-4 py-3 text-body-13 text-warning-700">
              Assay paused this tool, so agents cannot call it. Check your Inbox for why and what to do.
            </p>
          ) : null}

          {showFirstRun ? <FirstRunCard binding={binding} toolName={toolName} description={tool?.description ?? null} /> : null}

          <Panel className="w-full">
            <PanelBody className="p-4 tablet:p-5">
              <StatusTimeline steps={lifecycle(binding, testPassed)} label="Listing status" />
            </PanelBody>
          </Panel>

          {binding.status !== "DRAFT" ? (
            <section className="grid w-full grid-cols-1 gap-3 mobile:grid-cols-2 tablet:grid-cols-3">
              {group ? (
                <Figure label="Calls, last 24 hours" value={group.calls.toLocaleString("en-US")} />
              ) : null}
              {group?.earned ? <Figure label="Earned, last 24 hours" value={formatMoney(group.earned)} /> : null}
              {reading.headline ? (
                <Figure
                  label="Failures vs your promise"
                  value={reading.headline}
                  note={reading.sample ?? reading.advice}
                  tone={reading.tone === "danger" ? "danger" : reading.tone === "warning" ? "warning" : "ok"}
                />
              ) : reading.sample ? (
                <Figure label="Failures vs your promise" value="Too early" note={reading.sample} />
              ) : null}
            </section>
          ) : null}

          <Panel className="w-full">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Your terms</PanelTitle>
              </PanelTitles>
              {binding.status !== "DRAFT" ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={routes.binding(bindingId, "settings")}>Change</Link>
                </Button>
              ) : null}
            </PanelHeader>
            <PanelBody className="p-4 tablet:p-5">
              <dl className="grid w-full grid-cols-1 gap-x-6 gap-y-3 mobile:grid-cols-2">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-body-xs text-03">Price</dt>
                  <dd className="text-body-13 text-01">
                    {binding.pricingMode === "FREE"
                      ? "Free"
                      : `${formatMoneyNonZero(binding.price)} a call${
                          binding.pricingMode === "FREEMIUM" && binding.freeQuotaPerAgent
                            ? ` after ${binding.freeQuotaPerAgent.toLocaleString("en-US")} free calls per agent a day`
                            : ""
                        }`}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-body-xs text-03">Failures you promise to stay under</dt>
                  <dd className="text-body-13 text-01">{`${Number((binding.slaFailureRate * 100).toFixed(2))}%`}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-body-xs text-03">Time we wait for your API</dt>
                  <dd className="text-body-13 text-01">{`${binding.timeoutMs / 1000} seconds`}</dd>
                </div>
                {window ? (
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-body-xs text-03">Last call window opened</dt>
                    <dd className="text-body-13 text-01">
                      <LocalTime value={window.openedAt} />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </PanelBody>
          </Panel>
        </>
      )}

      <ConfirmSheet
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        tone="primary"
        title={`Pause ${toolName}?`}
        description="Agents stop being sent to it at once. Calls already made stay counted and paid, nothing you earned changes, and there is no penalty for pausing. Resume any time."
        changes={[{ label: "Status", before: "Live", after: "Paused" }]}
        confirmLabel="Pause tool"
        onConfirm={() => pause.mutateAsync()}
        describeError={(error) => (error instanceof ApiError ? plainError(error.code) : "It could not be paused. Try again.")}
      />
    </>
  );
}

export default function BindingOverviewPage() {
  return <OverviewContent />;
}
