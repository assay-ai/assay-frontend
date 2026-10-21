"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, CircleX, FileSearch, FlaskConical, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { stageCheckLabel, stageCheckTone, verdictChip } from "@/features/provider-verdicts/present";
import type { ProviderVerdictDetail } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plain } from "@/libs/plain-language";
import { useSearchParam } from "@/hooks/useSearchParam";
import { routes } from "@/libs/routes";
import { getProviderVerdict } from "@/services";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";
import { presentVerdict } from "@/utils/verdict";

/**
 * One checked call: what happened to the money, each check in plain words
 * (not-applicable checks in grey, never red), and one link to the evidence
 * (what we sent and what your API returned). The "Flag as platform defect"
 * button had no backend and is gone; a provider who disagrees with a penalty
 * disputes the penalty on chain, from Penalties.
 */

const TONE: Record<"ok" | "fail" | "muted" | "warn", string> = {
  ok: "bg-success-500 text-on-color",
  fail: "bg-danger-500 text-on-color",
  warn: "bg-warning-10 text-warning-600",
  muted: "border border-02 bg-02 text-03",
};

function Outcome({ detail }: { detail: ProviderVerdictDetail }) {
  const c = detail.consequence;
  const lines: { tone: "danger" | "warning" | "success" | "primary"; icon: React.ReactNode; text: string }[] = [];
  if (c.strike === true) {
    lines.push({
      tone: "danger",
      icon: <CircleX aria-hidden="true" className="size-4" />,
      text: `You were not paid for this call${c.providerAmount ? ` (${formatMoney(c.providerAmount)})` : ""}, and it counts as a failure against your promise.`,
    });
  } else if (c.strike === false) {
    lines.push({
      tone: "success",
      icon: <CircleCheck aria-hidden="true" className="size-4" />,
      text: `You were paid for this call${c.providerAmount ? `: ${formatMoney(c.providerAmount)}` : ""}.`,
    });
  } else {
    lines.push({ tone: "warning", icon: <TriangleAlert aria-hidden="true" className="size-4" />, text: "This call has not settled yet." });
  }
  if (c.settlementOutcome === "REFUND") {
    lines.push({ tone: "primary", icon: <CircleCheck aria-hidden="true" className="size-4" />, text: "The buyer was not charged." });
  } else if (c.settlementOutcome === "VOID") {
    lines.push({ tone: "primary", icon: <TriangleAlert aria-hidden="true" className="size-4" />, text: "The call was cancelled; nobody was charged." });
  }
  const box = {
    danger: "bg-danger-10 text-danger-700",
    warning: "bg-warning-10 text-warning-700",
    success: "bg-success-10 text-success-700",
    primary: "bg-primary-10 text-primary-700",
  };
  return (
    <div className="flex w-full flex-col gap-2">
      {lines.map((line, index) => (
        <div key={index} className={cn("flex items-start gap-2.5 rounded-lg px-3.5 py-3", box[line.tone])}>
          <span className="mt-0.5 shrink-0">{line.icon}</span>
          <p className="text-label-13">{line.text}</p>
        </div>
      ))}
    </div>
  );
}

export default function ProviderVerdictDetailPage() {
  const bindingId = useSearchParam("binding");
  const verdictId = useSearchParam("verdict");

  const query = useQuery({
    queryKey: ["provider", "verdict", verdictId],
    queryFn: () => getProviderVerdict(verdictId),
    retry: 0,
  });
  const detail = query.data;
  const back = (
    <Button variant="ghost" size="sm" icon={<ArrowLeft aria-hidden="true" />} asChild className="self-start">
      <Link href={`${routes.binding(bindingId, "quality")}&section=verdicts`}>Back to Quality</Link>
    </Button>
  );

  if (query.isPending) return <PageState kind="loading" rows={5} label="Loading this call" />;
  if (query.isError || !detail) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        {back}
        <PageState
          kind="error"
          title={notFound ? "This call could not be found" : "This call could not be loaded"}
          description={notFound ? "It may not be a call you served." : "Try again in a moment."}
          onRetry={notFound ? undefined : () => void query.refetch()}
          code={query.error instanceof ApiError ? query.error.code : null}
        />
      </>
    );
  }

  const chip = verdictChip(detail.verdictStatus);
  const presented = presentVerdict(detail.verdictStatus ?? undefined);
  const evidenceHref = routes.verdict(bindingId, verdictId, "evidence");
  const c = detail.consequence;

  return (
    <>
      {back}
      <header className="flex w-full flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Checked call</h1>
          <span className={cn("rounded-full px-2 py-0.5 text-label-xs", chip.className)}>{chip.label}</span>
        </div>
        <p className="text-body-13 text-02">
          {detail.reason ?? (detail.reasonCode ? plain(detail.reasonCode) : presented.shownAs)}
        </p>
        <p className="text-body-xs text-03">
          <UtcTime value={detail.createdAt} />
          {detail.sampled === true && detail.sampleDisplay ? ` · picked for a deeper check (${detail.sampleDisplay})` : ""}
        </p>
      </header>

      <Outcome detail={detail} />

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>The checks</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <ol className="flex w-full flex-col">
            {detail.stageResults.map((stage) => {
              const tone = stageCheckTone(stage.status);
              return (
                <li key={stage.stage} className="flex items-start gap-3 border-t border-01 py-3 first:border-t-0">
                  <span className={cn("mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-mono-2xs", TONE[tone])}>
                    {tone === "ok" ? "✓" : tone === "fail" ? "✕" : "–"}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-label-13 text-01">{stageCheckLabel(stage.stage)}</span>
                    <span className={cn("break-words text-body-xs", tone === "fail" ? "text-danger-700" : "text-02")}>
                      {stage.detail ?? stage.note ?? stage.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          {detail.verifiers.length > 0 ? (
            <details className="mt-2 rounded-lg bg-02 px-3.5 py-2.5">
              <summary className="cursor-pointer select-none text-label-13 text-02">Who checked it</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {detail.verifiers.map((vote, index) => (
                  <li key={`${vote.verifierId}-${index}`} className="flex flex-wrap justify-between gap-2 text-body-xs text-02">
                    <span className="font-mono">{vote.verifierId}</span>
                    <span>{plain(vote.outcome)}{vote.detail ? ` · ${vote.detail}` : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel className="w-full">
        <PanelBody className="flex flex-col gap-3 p-4 tablet:flex-row tablet:items-center tablet:justify-between tablet:p-5">
          <div className="flex items-start gap-2.5">
            <FileSearch aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
            <div className="flex flex-col gap-0.5">
              <span className="text-label-13 text-01">What we sent and what your API returned</span>
              <span className="text-body-xs text-03">The full request, your API&apos;s answer and the mapped result.</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href={evidenceHref}>Open the evidence</Link>
            </Button>
            <Button variant="ghost" size="sm" icon={<FlaskConical aria-hidden="true" />} asChild>
              <Link href={routes.bindingWizard(bindingId, "connect")}>Test your tool</Link>
            </Button>
          </div>
        </PanelBody>
      </Panel>

      {c.price ? (
        <Panel className="w-full">
          <PanelBody className="p-4 tablet:p-5">
            <dl className="flex w-full flex-col gap-2">
              {[
                ["Price", c.price],
                ["Your share", c.providerAmount],
                ["Assay fee", c.platformFee],
              ].map(([label, money]) =>
                money ? (
                  <div key={label as string} className="flex items-center justify-between gap-3">
                    <dt className="text-body-13 text-02">{label as string}</dt>
                    <dd className="font-mono text-mono-13 text-01">{formatMoney(money as never)}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </PanelBody>
        </Panel>
      ) : null}
    </>
  );
}
