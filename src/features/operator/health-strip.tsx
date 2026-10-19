"use client";

import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import * as React from "react";

import { MetricTile } from "@/components/ui/metric-tile";
import { DASH, count, percent } from "@/features/g34a/stats";
import type { PlatformHealth } from "@/interfaces/operator";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { healthIssues, lagText } from "./inbox";

function age(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return DASH;
  return seconds < 60 ? "1 min" : lagText(seconds);
}

/**
 * Platform health as one line — "All systems normal" in plain text, or what
 * is red in a danger box — that opens into the six figures on demand. It
 * stays closed even when red, so the inbox above it is never pushed below the
 * fold (operator review E): the figures are context, not tasks.
 */
export function HealthStrip({ health, error }: { health: PlatformHealth | undefined; error?: boolean }) {
  const issues = health ? healthIssues(health) : [];
  const red = issues.length > 0;
  const [open, setOpen] = React.useState(false);

  if (error) {
    return (
      <p className="flex w-full items-center gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-warning-700">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
        Platform health could not be read just now. It is tried again in a moment.
      </p>
    );
  }
  if (!health) return null;

  return (
    <section aria-label="Platform health" className="flex w-full flex-col gap-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "touch-target flex items-center gap-2 text-left text-body-13",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          red ? "w-full rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-danger-700" : "self-start rounded-md text-02 hover:text-01",
        )}
      >
        {red ? (
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success-500" />
        )}
        <span className="min-w-0 flex-1">
          {red ? (
            <>
              <span className="text-label-13">Platform health</span>
              {" · "}
              {issues.map((issue) => issue.text).join(" · ")}
            </>
          ) : (
            "All systems normal"
          )}
        </span>
        <span className="sr-only">{open ? ", hide figures" : ", show figures"}</span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-03 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid w-full grid-cols-1 gap-3 min-[480px]:grid-cols-2 desktop:grid-cols-3">
          <MetricTile
            label="Calls per minute"
            value={count(health.intentsPerMinute)}
            sub="paid calls started"
            meta={health.intentsPerMinuteDeltaVsHour === null ? DASH : `${percent(health.intentsPerMinuteDeltaVsHour)} vs an hour ago`}
          />
          <MetricTile
            label="Waiting to be checked"
            value={count(health.verificationBacklog)}
            sub="results"
            meta={health.verificationBacklogP95AgeSeconds === null ? DASH : `most within ${age(health.verificationBacklogP95AgeSeconds)}`}
          />
          <MetricTile
            label="False-positive rate"
            value={percent(health.falsePositiveRate)}
            sub="penalties we got wrong"
            meta={`gate ${percent(health.falsePositiveGate)}`}
            metaTone={health.falsePositiveRate >= health.falsePositiveGate ? "warning" : "default"}
          />
          <MetricTile label="Rules in trial" value={`${health.policiesInShadow} of ${health.policiesTotal}`} sub="checked but not enforced" />
          <MetricTile
            label="Stake bonded"
            value={formatMoney(health.stakeLocked)}
            sub={`bonded by ${count(health.providersWithStake)} ${health.providersWithStake === 1 ? "provider" : "providers"}`}
          />
        </div>
      ) : null}
    </section>
  );
}
