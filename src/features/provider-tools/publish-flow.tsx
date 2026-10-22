"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isRecordMissing } from "@/libs/record-missing";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Stepper } from "@/components/patterns/stepper";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { deprecateProviderToolMajor, listProviderTools, setProviderToolReplacement, type ProviderTool } from "@/services/provider-tools.service";
import { usePublicTools } from "@/features/explorer/use-public-explorer";
import { formatDate } from "@/libs/utc-time";
import { toast } from "@/utils/toast";
import { UtcTime } from "@/components/patterns/utc-time";
import { SUPPORT_URL } from "@/libs/support";

import { ContractStep } from "./contract-step";
import { doneSteps, earliestSunsetDay, isPublishStep, providerToolErrorView, providerToolState, PUBLISH_STEPS, resumeStep, type PublishStepId, type VersionRow } from "./model";
import { NameStep } from "./name-step";
import { providerToolKeys, useProviderTool, useProviderToolGate } from "./queries";
import { ConnectStep, ShareStep } from "./share-steps";
import { ProviderToolChips, VersionHistory } from "./ui";

/**
 * "Publish your own API" (design spec §7.10): one flow, one URL, four steps.
 *
 *   1 Name               {handle}__{tool}, previewed as a model sees it
 *   2 Inputs & outputs   the contract, with the safety screen's findings
 *   3 Connect & check    the listing that serves it, and the publish gate
 *   4 Who can use it     Only my team / Anyone with the link / Listed (review)
 *
 * New: `/provider/apis/new` (step 1 only, nothing saved yet). Saved:
 * `/provider/apis/view?id=&step=`; without `step` it resumes at the first
 * step not done. Below the steps: versions, quality and the replacement.
 */

export function PublishApiFlow({ toolId }: { toolId: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const toolQuery = useProviderTool(toolId);
  const tool = toolQuery.data ?? null;
  const gateQuery = useProviderToolGate(toolId, Boolean(tool && tool.currentVersion !== null));
  const gate = gateQuery.data ?? null;

  const stepParam = params.get("step");
  const gateSettled = !tool || tool.currentVersion === null || !gateQuery.isPending;
  const step: PublishStepId = !tool ? "name" : isPublishStep(stepParam) ? stepParam : gateSettled ? resumeStep(tool, gate) : "contract";
  const done = doneSteps(tool, gate);

  const go = (next: PublishStepId) => {
    if (!tool) return;
    router.replace(routes.providerApi(tool.id, next), { scroll: false });
    window.scrollTo({ top: 0 });
  };

  const back = (
    <Link href="/provider/apis" className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-md text-label-13 text-02 hover:text-01">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Your APIs
    </Link>
  );

  if (toolId && toolQuery.isPending) {
    return (
      <>
        {back}
        <PageState kind="loading" rows={5} label="Opening your API" />
      </>
    );
  }
  if (toolId && (toolQuery.isError || !tool)) {
    const missing = isRecordMissing(toolQuery.error);
    return (
      <>
        {back}
        <PageState
          kind={missing ? "empty" : "error"}
          title={missing ? "This API could not be found" : "This API could not be opened"}
          description={missing ? "It may have been removed, or it belongs to another account." : "Try again in a moment."}
          {...(missing ? { action: { label: "See your APIs", href: "/provider/apis" } } : { onRetry: () => void toolQuery.refetch() })}
          code={toolQuery.error instanceof ApiError ? toolQuery.error.code : null}
        />
      </>
    );
  }

  const state = tool ? providerToolState(tool) : null;
  const takenDown = state?.id === "TAKEN_DOWN";

  return (
    <div className="flex w-full flex-col gap-5">
      {back}
      <header className="flex w-full flex-col gap-1.5">
        {tool ? (
          <>
            <h1 className="break-all font-mono text-heading-sm text-01 tablet:text-heading-md">{tool.name}</h1>
            <ProviderToolChips tool={tool} />
            {state ? <p className="text-body-13 text-02">{state.detail}</p> : null}
            {tool.review.status === "PENDING" ? (
              <p className="text-body-13 text-02" data-testid="in-review-line">
                Reviewing {tool.review.reviewSemver ? `v${tool.review.reviewSemver}` : "it"} for “Listed in the catalogue”
                {tool.review.kind === "CHANGE" && tool.draft?.changelog ? `: ${tool.draft.changelog}` : "."}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="text-heading-sm text-01 tablet:text-heading-md">Publish your API</h1>
            <p className="text-body-13 text-03">Four steps. Your progress is saved after the first one, and only your team sees it until step 4.</p>
          </>
        )}
      </header>

      {takenDown ? (
        <div role="alert" className="flex flex-col gap-1.5 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-3 text-body-13 text-danger-700" data-testid="taken-down">
          <p>
            Assay took this tool down{tool?.takedown?.at ?? tool?.removedAt ? <> on <UtcTime value={tool?.takedown?.at ?? tool?.removedAt} alwaysDay /></> : null}. It is removed from every view, including pinned tool set versions, and calls to it get an error. It can&apos;t be edited.
          </p>
          {tool?.takedown?.reasonLabel || tool?.takedown?.reasonCode ? (
            <p data-testid="takedown-reason">
              <span className="text-label-13">Why:</span> {tool.takedown.reasonLabel ?? tool.takedown.reasonCode}
            </p>
          ) : null}
          {tool?.takedown?.publicNote ? (
            <p className="[overflow-wrap:anywhere]" data-testid="takedown-note">
              <span className="text-label-13">Assay&apos;s note to you:</span> {tool.takedown.publicNote}
            </p>
          ) : null}
          {!tool?.takedown?.reasonCode && !tool?.takedown?.publicNote ? <p>The notice Assay sent to your Inbox has the details.</p> : null}
          <p className="flex flex-wrap gap-x-4">
            <Link href="/provider/inbox" className="inline-flex min-h-10 items-center text-primary-600 hover:underline">
              Open your Inbox
            </Link>
            <a href={SUPPORT_URL ?? "/how-it-works"} className="inline-flex min-h-10 items-center text-primary-600 hover:underline">
              {SUPPORT_URL ? "Contact support" : "Help & contact"}
            </a>
          </p>
        </div>
      ) : (
        <>
          <Stepper
            steps={PUBLISH_STEPS.map((s) => ({ id: s.id, label: s.label, state: s.id === step ? "current" : done.has(s.id) ? "done" : "upcoming" }))}
            sticky
            label="Publishing steps"
            onSelect={(id) => {
              if (isPublishStep(id) && id !== step) go(id);
            }}
          />
          {tool && tool.currentVersion === null ? (
            <p className="text-body-13 text-03" data-testid="locked-steps">
              Steps 3 and 4 open once you publish a first version in step 2: the endpoint is tested against it, and only a published version can be shared.
            </p>
          ) : null}
          {step === "name" ? <NameStep tool={tool} onContinue={() => go("contract")} /> : null}
          {step === "contract" && tool ? <ContractStep key={tool.id} tool={tool} onStep={go} /> : null}
          {step === "connect" && tool ? (
            <ConnectStep tool={tool} gate={gate} gateLoading={gateQuery.isPending && tool.currentVersion !== null} gateError={gateQuery.isError} onRecheck={() => void gateQuery.refetch()} onStep={go} />
          ) : null}
          {step === "share" && tool ? <ShareStep tool={tool} gate={gate} onStep={go} /> : null}
        </>
      )}

      {tool ? <ToolFacts tool={tool} readOnly={takenDown} /> : null}
    </div>
  );
}

/** `readOnly`: a taken-down tool can't be changed, so its actions are hidden. */
function ToolFacts({ tool, readOnly }: { tool: ProviderTool; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const [deprecating, setDeprecating] = React.useState<VersionRow | null>(null);
  const clear = useMutation({
    mutationFn: () => setProviderToolReplacement(tool.id, null),
    onSuccess: (updated) => {
      queryClient.setQueryData(providerToolKeys.one(updated.id), updated);
      toast.success("Agents are no longer pointed elsewhere");
    },
    onError: (error) => toast.error(providerToolErrorView(error).text),
  });
  const q = tool.quality;
  const pct = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);
  return (
    <>
      {tool.replacementName ? (
        <section className="flex flex-col gap-2 rounded-xl border border-01 bg-01 px-4 py-3.5 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="text-body-13 text-01">
            Agents of this tool are pointed to the standard tool <span className="font-mono text-mono-13">{tool.replacementName}</span>, which has backup providers.
          </p>
          {readOnly ? null : (
            <Button variant="ghost" size="sm" className="touch-target" loading={clear.isPending} onClick={() => clear.mutate()}>
            Stop pointing there
          </Button>
          )}
        </section>
      ) : null}
      <section aria-labelledby="versions-title" className="flex w-full flex-col gap-2">
        <h2 id="versions-title" className="text-label-md text-01">
          Versions
        </h2>
        <VersionHistory tool={tool} onDeprecate={readOnly ? undefined : setDeprecating} />
      </section>
      <section aria-labelledby="quality-title" className="flex w-full flex-col gap-2">
        <h2 id="quality-title" className="text-label-md text-01">
          Quality, last {q.windowDays} days
        </h2>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-01 bg-01 px-4 py-3.5 tablet:grid-cols-4">
          {[
            ["Paid calls", q.calls.toLocaleString("en-US")],
            ["Answers that matched the schema", pct(q.schemaPassRate)],
            ["Answers that passed your checks", pct(q.rulesPassRate)],
            ["Upheld reports", q.disputesUpheld === null ? "—" : `${q.disputesUpheld} of ${q.disputesDecided ?? 0}`],
          ].map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-body-xs text-03">{label}</dt>
              <dd className="text-label-sm tabular-nums text-01">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <DeprecateSheet tool={tool} row={deprecating} onClose={() => setDeprecating(null)} />
    </>
  );
}

/** Tools a deprecated major may point to: listed tools, and your own tools shared at least as widely; never itself, a deprecated or a removed one. */
function useReplacementCandidates(tool: ProviderTool, enabled: boolean): { id: string; name: string; note: string | null }[] {
  const listed = usePublicTools();
  const own = useQuery({ queryKey: [...providerToolKeys.all, "replacement-candidates"], queryFn: () => listProviderTools({ limit: 100 }), enabled, retry: 0 });
  return React.useMemo(() => {
    const rank = (v: string) => ["PRIVATE", "UNLISTED", "LISTED"].indexOf(v);
    const rows = new Map<string, { id: string; name: string; note: string | null }>();
    for (const t of listed.data?.tools ?? []) {
      // Serving now, and not itself pointing elsewhere (a tool whose current version is deprecated names its replacement).
      if (t.id === tool.id || t.routable === false || t.replacementName) continue;
      rows.set(t.id, { id: t.id, name: t.name, note: t.kind === "PROVIDER" ? "one maker's API" : "standard tool" });
    }
    for (const t of own.data?.items ?? []) {
      if (t.id === tool.id || t.status !== "ACTIVE" || t.removedAt || rank(t.visibility) < rank(tool.visibility)) continue;
      if (!rows.has(t.id)) rows.set(t.id, { id: t.id, name: t.name, note: "your own" });
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [listed.data, own.data, tool.id, tool.visibility]);
}

function DeprecateSheet({ tool, row, onClose }: { tool: ProviderTool; row: VersionRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const min = earliestSunsetDay(tool.earliestSunsetAt);
  const [day, setDay] = React.useState(min);
  React.useEffect(() => setDay(min), [row, min]);
  const major = row?.semver.split(".")[0] ?? "";
  const [replacement, setReplacement] = React.useState("");
  React.useEffect(() => setReplacement(""), [row]);
  // earliestSunsetAt moves with the clock: read the tool again whenever the sheet opens.
  React.useEffect(() => {
    if (row) void queryClient.invalidateQueries({ queryKey: providerToolKeys.one(tool.id) });
  }, [row, queryClient, tool.id]);
  const candidates = useReplacementCandidates(tool, row !== null);
  const run = useMutation({
    mutationFn: () => deprecateProviderToolMajor(tool.id, row!.version, `${day}T00:00:00.000Z`, replacement || null),
    onSuccess: (updated) => {
      queryClient.setQueryData(providerToolKeys.one(updated.id), updated);
      toast.success(`v${major} is deprecated; it stops on ${day} (UTC)${updated.replacementName ? `. Agents are pointed to ${updated.replacementName}` : ""}`);
      onClose();
    },
  });
  const tooSoon = day < min;
  const current = tool.versions.find((v) => v.isCurrent) ?? null;
  const inWords = /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(`${day}T00:00:00.000Z`) : null;
  return (
    <Sheet open={row !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="tablet:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>Deprecate v{major}?</SheetTitle>
          <SheetDescription>Agents locked to v{major} keep working until the date below, and get a notice now. After it, v{major} stops answering calls.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3">
          <label className="flex flex-col gap-1.5" data-testid="deprecate-replacement">
            <span className="text-label-13 text-01">Replacement</span>
            <select value={replacement} onChange={(e) => setReplacement(e.target.value)} className="min-h-10 rounded-md border border-02 bg-01 px-2 text-body-13 text-01">
              <option value="">{current ? `This tool's v${current.semver} (agents get it by default)` : "No other tool"}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.note ? ` (${c.note})` : ""}
                </option>
              ))}
            </select>
            <span className="text-body-xs text-03">
              Agents locked to v{major} are told to move to it before the date. Offered: tools that serve now, are not deprecated, and reach at least the same agents (listed tools, or your own shared at least as widely).
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label-13 text-01">Stops on (UTC)</span>
            <input type="date" value={day} min={min} onChange={(e) => setDay(e.target.value)} className="min-h-10 rounded-md border border-02 bg-01 px-3 font-mono text-mono-sm text-01" />
            <span className={tooSoon ? "text-body-xs text-danger-600" : "text-body-xs text-03"}>
              {inWords && day !== min ? `Stops on ${inWords} (UTC). ` : ""}
              {`Earliest: ${formatDate(`${min}T00:00:00.000Z`)} (UTC), so callers get at least 90 days' notice.`}
            </span>
          </label>
          {run.isError ? (
            <div role="alert" className="text-body-13 text-danger-700">
              <p>{providerToolErrorView(run.error).text}</p>
              {providerToolErrorView(run.error).problems.length > 0 ? (
                <ul className="list-disc pl-4">
                  {providerToolErrorView(run.error).problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={tooSoon} loading={run.isPending} onClick={() => run.mutate()}>
              Deprecate v{major}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Keep it
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
