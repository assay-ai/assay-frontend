"use client";

import * as React from "react";

import { Skeleton } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { buildMcpUrl, parseMcpUrl, type ToolsetChoice } from "@/features/connect/mcp-url";
import { moveLockBody } from "@/features/toolsets/access-result";
import { diffSnapshots, snapshotOfVersion } from "@/features/toolsets/sharing";
import type { AgentAccess, ToolsetDiff } from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

import { CopyLine, DiffView } from "./toolset-bits";
import { usePublicToolset, usePublicToolsetVersions, useToolsetByToken, useToolsets, useToolsetVersion, useUpdateAccess } from "./use-toolsets";

/**
 * "Update available" (design spec §7.10): what changed between the version an
 * agent uses and the newest one, then the one step that takes it — "Copy v4
 * URL" for a server ("Your app still uses v3 until you replace it"), or
 * "Move the lock to v4" for what an agent may use. The diff always comes
 * first: nothing moves until the person has seen it.
 */

export interface UpdateTarget {
  /** The tool set as a URL choice, at the version in use. */
  choice: ToolsetChoice;
  name: string;
  from: number;
  /** Known up front (access entries carry it); else read from the tool set. */
  to?: number | null;
  /** Set on "What this agent can use": offers "Move the lock". */
  access?: { access: AgentAccess; toolsetId: string } | null;
  /** A diff already in hand (the update alert carries one). */
  diff?: ToolsetDiff | null;
  /** Keep `?free=` and `discovery=` of the URL in use. */
  url?: string | null;
}

export function UpdateSheet({ target, onOpenChange }: { target: UpdateTarget | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[560px]">{target ? <UpdateBody target={target} onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

function UpdateBody({ target, onDone }: { target: UpdateTarget; onDone: () => void }) {
  const { choice } = target;
  const sets = useToolsets();
  const own = choice.kind === "toolset" ? (sets.data?.items.find((s) => s.slug === choice.slug) ?? null) : null;
  const pub = usePublicToolset(choice.kind === "shared" ? choice.handle : null, choice.kind === "shared" ? choice.slug : null);
  const versions = usePublicToolsetVersions(choice.kind === "shared" ? choice.handle : null, choice.kind === "shared" ? choice.slug : null);
  const link = useToolsetByToken(choice.kind === "link" ? choice.token : null, null);
  const latest = target.to ?? (choice.kind === "toolset" ? (own?.latestVersion ?? null) : choice.kind === "shared" ? (pub.data?.version ?? null) : (link.data?.version ?? null));
  const before = useToolsetVersion(own?.id ?? null, own ? target.from : null);
  const after = useToolsetVersion(own?.id ?? null, own ? latest : null);
  const update = useUpdateAccess(target.access?.access.agentId ?? null);

  const diff = target.diff ?? (before.data && after.data ? diffSnapshots(snapshotOfVersion(before.data), snapshotOfVersion(after.data)) : null);
  const changelogs = (versions.data?.versions ?? []).filter((v) => latest !== null && v.version > target.from && v.version <= latest).sort((a, b) => b.version - a.version);
  const loading = latest === null || (own !== null && !diff && (before.isPending || after.isPending)) || (choice.kind === "shared" && !diff && versions.isPending);
  const parsed = target.url ? parseMcpUrl(target.url) : null;
  const nextUrl = latest ? buildMcpUrl({ ...choice, version: latest }, parsed?.options ?? { free: false }) : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{latest ? `${target.name} v${latest} is out` : `A new version of ${target.name}`}</SheetTitle>
        <SheetDescription>You use v{target.from}. Nothing changes for your agent until you choose to.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-[18px] pb-4 pt-3" data-testid="update-sheet">
        <section className="flex flex-col gap-2">
          <h3 className="text-label-13 text-01">What changed since v{target.from}</h3>
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : diff ? (
            <DiffView diff={diff} />
          ) : changelogs.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {changelogs.map((v) => (
                <li key={v.version} className="flex flex-col gap-0.5 rounded-lg bg-02 px-3 py-2">
                  <span className="text-label-13 text-01">
                    v{v.version} · <UtcTime value={v.publishedAt} dateOnly /> UTC
                  </span>
                  <span className="text-body-13 text-02">{v.changelog ?? "No notes."}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-13 text-02">The publisher left no notes for these versions. Open the tool set&apos;s page to see its tools now.</p>
          )}
        </section>

        {target.access ? (
          <section className="flex flex-col gap-2">
            <p className="text-body-13 text-02">
              This agent may use what v{target.from} holds. Moving the lock lets it use v{latest ?? "…"}&apos;s tools instead, on every server.
            </p>
            <Button
              className="self-start"
              loading={update.isPending}
              disabled={!latest}
              onClick={() =>
                latest &&
                update.mutate(moveLockBody(target.access!.access, target.access!.toolsetId, latest, target.name), {
                  onSuccess: () => {
                    toast.success(`${target.name} moved to v${latest}`);
                    onDone();
                  },
                })
              }
            >
              Move the lock to v{latest ?? "…"}
            </Button>
          </section>
        ) : null}

        {nextUrl ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-label-13 text-01">{target.access ? "Its server URL" : "Use the new version"}</h3>
            <CopyLine value={nextUrl} label={`Copy v${latest} URL`} testId="update-copy" />
            <p className="text-body-xs text-03">Your app still uses v{target.from} until you replace it.</p>
          </section>
        ) : null}
      </div>
    </>
  );
}
