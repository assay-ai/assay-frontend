"use client";

import { ChevronDown, History } from "lucide-react";
import * as React from "react";

import { SkeletonRows } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { buildMcpUrl } from "@/features/connect/mcp-url";
import { lockLabel } from "@/features/toolsets/labels";
import { statRows } from "@/features/toolsets/public";
import { diffSnapshots, ruleDetails, ruleOfSnapshot, snapshotOfVersion } from "@/features/toolsets/sharing";
import type { Toolset, ToolsetVersionSummary } from "@/services/toolsets.service";
import { cn } from "@/utils";

import { Chip, CopyLine, DiffView, FigureGrid } from "./toolset-bits";
import { errorText, useToolsetStats, useToolsetVersion, useToolsetVersions } from "./use-toolsets";

/**
 * A tool set's versions (design spec §7.7): each one frozen, newest first,
 * with its notes. Opening one shows what changed from the one before and
 * "Lock to vN": the URL that serves exactly that version, for an app that
 * should get no surprise changes.
 */
export function VersionHistory({ set }: { set: Toolset }) {
  const query = useToolsetVersions(set.id);
  const [open, setOpen] = React.useState<number | null>(null);
  const versions = query.data ?? [];
  return (
    <section aria-label="Versions" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5" data-testid="toolset-versions">
      <div className="flex items-center gap-2">
        <History aria-hidden="true" className="size-4 text-03" />
        <h2 className="text-label-md text-01">Versions</h2>
      </div>
      <p className="text-body-xs text-03">
        A version is a frozen copy of the Draft. Shared links and locked URLs serve a version, so your edits reach them only when you publish the next one.
      </p>
      {query.isPending ? (
        <SkeletonRows rows={2} />
      ) : query.isError ? (
        <p className="flex flex-wrap items-center gap-2 text-body-13 text-02">
          The versions could not be loaded: {errorText(query.error).replace(/\.$/, "")}.
          <button type="button" className="min-h-10 font-semibold text-primary-600 hover:underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : versions.length === 0 ? (
        <p className="text-body-13 text-02">No versions yet. Share it, or save a version for your team, to lock agents to one.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
          {versions.map((v, i) => (
            <VersionRow
              key={v.version}
              set={set}
              version={v}
              previous={versions[i + 1]?.version ?? null}
              latest={i === 0}
              open={open === v.version}
              onToggle={() => setOpen(open === v.version ? null : v.version)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function VersionRow({
  set,
  version,
  previous,
  latest,
  open,
  onToggle,
}: {
  set: Toolset;
  version: ToolsetVersionSummary;
  previous: number | null;
  latest: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-testid="version-row">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-10 w-full items-start gap-2 text-left">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-label-13 text-01">
            v{version.version}
            {latest ? <Chip tone="primary">Newest</Chip> : null}
            <span className="font-normal text-03">
              <UtcTime value={version.publishedAt} /> · {version.toolCount} tool{version.toolCount === 1 ? "" : "s"}
            </span>
          </span>
          <span className="text-body-13 text-02 [overflow-wrap:anywhere]">{version.changelog ?? "No notes."}</span>
        </span>
        <ChevronDown aria-hidden="true" className={cn("mt-1 size-4 shrink-0 text-03 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <VersionDetail set={set} version={version.version} previous={previous} /> : null}
    </li>
  );
}

function VersionDetail({ set, version, previous }: { set: Toolset; version: number; previous: number | null }) {
  const now = useToolsetVersion(set.id, version);
  const before = useToolsetVersion(set.id, previous);
  const diff = now.data ? diffSnapshots(before.data ? snapshotOfVersion(before.data) : null, snapshotOfVersion(now.data)) : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-02 p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-label-xs text-02">{previous ? `What changed from v${previous}` : "What it holds"}</span>
        {now.isPending || (previous && before.isPending) ? (
          <SkeletonRows rows={1} />
        ) : diff ? (
          <DiffView diff={diff} ruleOf={before.data && now.data ? ruleDetails(before.data.entries, now.data.entries, ruleOfSnapshot) : undefined} />
        ) : (
          <p className="text-body-13 text-02">This version could not be loaded.</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-label-xs text-02">{lockLabel(version)}</span>
        <CopyLine value={buildMcpUrl({ kind: "toolset", slug: set.slug, version }, { free: false })} label={`Copy v${version} URL`} />
        <p className="text-body-xs text-03">For your team&apos;s apps: this URL keeps serving v{version} whatever you change in the Draft.</p>
      </div>
    </div>
  );
}

/**
 * The publisher's weekly figures (design spec §7.8, FR-10): the public ones,
 * then calls, errors and not-charged calls per tool and who uses which
 * version. Every cell 1–4 teams contribute to reads "Fewer than 5 orgs"; no
 * buyer is ever named.
 */
export function PublisherStats({ set }: { set: Toolset }) {
  const shared = set.visibility !== "PRIVATE" || Boolean(set.sharingEndsAt);
  const query = useToolsetStats(set.id, shared && Boolean(set.latestVersion));
  if (!shared || !set.latestVersion) return null;
  const stats = query.data;
  const dashboard = stats?.dashboard;
  return (
    <section aria-label="Usage" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5" data-testid="publisher-stats">
      <h2 className="text-label-md text-01">Who uses it</h2>
      <p className="text-body-xs text-03">Only you see this. Calls from your own team are not counted, and no one who uses it is named.</p>
      {query.isError ? (
        <p className="text-body-13 text-02">The figures could not be loaded: {errorText(query.error)}</p>
      ) : (
        <FigureGrid rows={statRows(stats?.figures ?? null)} weekStart={stats?.weekStart ?? null} loading={query.isPending} />
      )}
      {dashboard && dashboard.tools.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-label-13 text-01">Per tool (30 days)</h3>
          <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01" data-testid="stats-tools">
            {dashboard.tools.map((t) => (
              <li key={t.toolId} className="flex flex-col gap-0.5 px-3 py-2 tablet:flex-row tablet:items-center tablet:gap-3">
                <span className="min-w-0 flex-1 font-mono text-mono-12 text-01 [overflow-wrap:anywhere]">{t.toolName}</span>
                {t.withheld ? (
                  <span className="text-body-xs text-03">Fewer than 5 orgs: hidden</span>
                ) : (
                  <span className="text-body-xs tabular-nums text-02">
                    {t.calls?.display ?? "—"} calls · {t.errorRatePercent ?? "—"}% errors · {t.notChargedRatePercent ?? "—"}% not charged
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {dashboard && dashboard.versions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-label-13 text-01">Which version teams use</h3>
          <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01" data-testid="stats-versions">
            {dashboard.versions.map((v) => (
              <li key={v.version} className="flex flex-col gap-0.5 px-3 py-2 tablet:flex-row tablet:items-center tablet:gap-3">
                <span className="min-w-0 flex-1 text-label-13 text-01">v{v.version}</span>
                <span className="text-body-xs tabular-nums text-02">
                  {v.orgs.display} {v.orgs.value === null ? "" : `team${v.orgs.value === 1 ? "" : "s"} `}on it · stopped after this update: {v.stoppedAfterUpdate.display}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
