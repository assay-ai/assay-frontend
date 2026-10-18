"use client";

import { Check, CircleAlert, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import type { ProviderTool, ProviderToolGate, ProviderToolSummary, ScreenFinding } from "@/services/provider-tools.service";
import { cn } from "@/utils";

import { findingPlace, findingText, gateRows, providerToolState, showsNotReviewed, versionRows, type PublishStepId, type VersionRow } from "./model";

/**
 * The small parts every "Publish your own API" screen shares: the state
 * chip, the "Not reviewed" badge, the publish gate checklist with its fixes,
 * the schema screen findings, and the version history.
 */

export function ProviderToolChips({ tool, className }: { tool: Pick<ProviderToolSummary, "status" | "visibility" | "review" | "removedAt" | "currentVersion" | "replacementName" | "notReviewed" | "hasDraft">; className?: string }) {
  const state = providerToolState(tool);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <Chip tone={state.tone}>{state.label}</Chip>
      {showsNotReviewed(tool) ? <NotReviewedChip /> : null}
      {tool.hasDraft && state.id !== "DRAFT" ? <Chip>Unpublished changes</Chip> : null}
    </span>
  );
}

/** One maker's own API that no operator approved yet. */
export function NotReviewedChip() {
  return (
    <Chip tone="warning">
      <ShieldAlert aria-hidden="true" className="size-3" />
      Not reviewed
    </Chip>
  );
}

/** The tier a reviewer gave: "Verified" (never "Guaranteed" for one maker's API). */
export function TierChip({ tier }: { tier: string }) {
  if (tier === "VERIFIED") return <Chip tone="success">Verified</Chip>;
  return <Chip>Unverified</Chip>;
}

export function ScreenFindings({ findings, className }: { findings: readonly ScreenFinding[]; className?: string }) {
  if (findings.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5", className)} data-testid="screen-findings">
      {findings.map((finding, i) => (
        <li key={`${finding.location}:${finding.code}:${i}`} className="flex items-start gap-2 rounded-md bg-danger-10 px-3 py-2 text-body-13 text-danger-700">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="text-label-13">{findingPlace(finding.location)}:</span> {findingText(finding)}
            {finding.detail ? <span className="block text-body-xs text-danger-600">{finding.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The publish gate as a checklist: each check met or not, and for each one
 * not met what to do, with a button that goes there.
 */
export function GateChecklist({
  gate,
  tool,
  onStep,
}: {
  gate: ProviderToolGate;
  tool: Pick<ProviderTool, "id" | "binding">;
  onStep: (step: PublishStepId) => void;
}) {
  const rows = gateRows(gate, tool);
  const findings = gate.screen.flatMap((s) => s.findings.map((f) => ({ ...f, semver: s.semver })));
  return (
    <div className="flex flex-col gap-3" data-testid="gate-checklist">
      <p className={cn("text-label-sm", gate.passed ? "text-success-700" : "text-01")} role="status">
        {gate.passed ? "Every check passes. You can share it." : `${rows.filter((r) => !r.met).length} of ${rows.length} checks to fix before others can use it`}
      </p>
      <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
        {rows.map((row) => (
          <li key={row.requirement} className="flex flex-col gap-2 px-3.5 py-3 tablet:flex-row tablet:items-center tablet:justify-between">
            <span className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", row.met ? "bg-success-10 text-success-700" : "bg-danger-10 text-danger-700")}
              >
                {row.met ? <Check className="size-3" /> : <X className="size-3" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-label-13 text-01">
                  {row.label}
                  <span className="sr-only">{row.met ? ": done" : ": not yet"}</span>
                </span>
                {row.met ? null : <span className="text-body-13 text-02">{row.todo}</span>}
                {!row.met && row.detail ? <span className="text-body-xs text-03 [overflow-wrap:anywhere]">{row.detail}</span> : null}
              </span>
            </span>
            {!row.met && row.fix ? (
              row.fix.kind === "link" ? (
                <Button asChild variant="secondary" size="sm" className="touch-target self-start tablet:self-auto">
                  <Link href={row.fix.href}>{row.fix.label}</Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" className="touch-target self-start tablet:self-auto" onClick={() => onStep((row.fix as { step: PublishStepId }).step)}>
                  {row.fix.label}
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {findings.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-label-13 text-01">What the safety screen found</p>
          <p className="text-body-xs text-03">Everything an agent reads is screened: the summary, the description, every field description and the examples.</p>
          <ScreenFindings findings={findings} />
        </div>
      ) : null}
    </div>
  );
}

const VERSION_TONE: Record<string, "neutral" | "warning" | "danger" | "success"> = {
  ACTIVE: "success",
  DEPRECATED: "warning",
  RETIRED: "danger",
};

/** Published versions, newest first, with the one agents get and what each changed. */
export function VersionHistory({ tool, onDeprecate }: { tool: Pick<ProviderTool, "versions" | "currentVersion" | "visibility" | "status" | "removedAt">; onDeprecate?: (row: VersionRow) => void }) {
  const rows = versionRows(tool);
  // A taken-down tool serves no version, whatever each one's own status says.
  const removed = Boolean(tool.removedAt) || tool.status === "REMOVED";
  if (rows.length === 0) return <p className="text-body-13 text-03">No version is published yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01" data-testid="version-history">
      {rows.map((row) => (
        <li key={row.version} className="flex flex-col gap-1.5 px-3.5 py-3 tablet:flex-row tablet:items-start tablet:justify-between">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-mono-13 text-01">v{row.semver}</span>
              {removed ? <Chip tone="danger">Not served</Chip> : <Chip tone={VERSION_TONE[row.status] ?? "neutral"}>{row.statusLabel}</Chip>}
              {row.isCurrent && !removed ? <Chip tone="primary">Agents get this one</Chip> : null}
              {tool.visibility === "LISTED" || row.approved ? row.approved ? <Chip tone="success">Reviewed</Chip> : <Chip tone="warning">Not reviewed</Chip> : null}
            </span>
            <span className="text-body-xs text-03">
              {row.publishedAt ? (
                <>
                  Published <UtcTime value={row.publishedAt} midSentence />
                </>
              ) : (
                "Not published"
              )}
              {row.sunsetAt ? (
                <>
                  {" "}
                  · stops <UtcTime value={row.sunsetAt} dateOnly /> (UTC)
                </>
              ) : null}
            </span>
            {row.changelog ? <span className="text-body-13 text-02 [overflow-wrap:anywhere]">{row.changelog}</span> : null}
          </span>
          {row.canDeprecate && onDeprecate ? (
            <Button variant="ghost" size="sm" className="touch-target self-start" onClick={() => onDeprecate(row)}>
              Deprecate v{row.semver.split(".")[0]}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
