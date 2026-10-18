"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Skeleton } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePublicTools } from "@/features/explorer/use-public-explorer";
import { buildMcpUrl, parseMcpUrl, type ToolsetChoice } from "@/features/connect/mcp-url";
import { moveLockBody } from "@/features/toolsets/access-result";
import { priceOfTool } from "@/features/toolsets/public";
import { diffSnapshots, ruleDetails, ruleOfSnapshot, snapshotOfVersion } from "@/features/toolsets/sharing";
import { recordConnectUrl, type AgentAccess, type ToolsetDiff } from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

import { CopyLine, DiffView } from "./toolset-bits";
import {
  toolsetKeys,
  usePublicToolset,
  usePublicToolsetVersion,
  useToolsetByToken,
  useToolsets,
  useToolsetVersion,
  useUpdateAccess,
} from "./use-toolsets";

/**
 * "Update available" (design spec §7.10): what changed between the version in
 * use and the newest one, then the two separate steps it can lead to:
 *
 *   - Your app's URL: "Copy v4 URL" changes what your app connects to ("Your
 *     app still uses v3 until you replace it");
 *   - What this agent may use: "Let this agent use v4's tools" changes what
 *     the agent is allowed to call, on every server.
 *
 * The diff always comes first: nothing moves until the person has seen it.
 */

export interface UpdateTarget {
  /** The tool set as a URL choice, at the version in use. */
  choice: ToolsetChoice;
  name: string;
  from: number;
  /** Known up front (servers and access entries carry it); else read from the tool set. */
  to?: number | null;
  /** The URL at `to`, as the server spelt it (`ServerInUse.latestUrl`). */
  toUrl?: string | null;
  /** Set on "What this agent can use": offers "Let this agent use vN's tools". */
  access?: { access: AgentAccess; toolsetId: string } | null;
  /** A diff already in hand (the update alert carries one). */
  diff?: ToolsetDiff | null;
  /** The URL in use, to keep its `?free=` and `discovery=`. */
  url?: string | null;
  /** The agent whose app uses the URL: copying the new one hands it out to that agent. */
  agentId?: string | null;
  serverName?: string | null;
}

export function UpdateSheet({ target, onOpenChange }: { target: UpdateTarget | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[560px]">{target ? <UpdateBody target={target} onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

export function UpdateBody({ target, onDone }: { target: UpdateTarget; onDone: () => void }) {
  const { choice } = target;
  const queryClient = useQueryClient();
  const sets = useToolsets();
  const own = choice.kind === "toolset" ? (sets.data?.items.find((s) => s.slug === choice.slug) ?? null) : null;
  const pub = usePublicToolset(choice.kind === "shared" && !target.to ? choice.handle : null, choice.kind === "shared" && !target.to ? choice.slug : null);
  const link = useToolsetByToken(choice.kind === "link" ? choice.token : null, target.to ?? null, choice.kind === "link" ? target.from : null);
  const latest = target.to ?? (choice.kind === "toolset" ? (own?.latestVersion ?? null) : choice.kind === "shared" ? (pub.data?.version ?? null) : (link.data?.version ?? null));
  const version = usePublicToolsetVersion(
    choice.kind === "shared" && !target.diff ? choice.handle : null,
    choice.kind === "shared" && !target.diff ? choice.slug : null,
    latest,
    target.from,
  );
  // The version in use, for what changed in each tool's rule.
  const fromShared = usePublicToolsetVersion(choice.kind === "shared" ? choice.handle : null, choice.kind === "shared" ? choice.slug : null, target.from, null);
  const fromLink = useToolsetByToken(choice.kind === "link" ? choice.token : null, target.from);
  const before = useToolsetVersion(own?.id ?? null, own ? target.from : null);
  const after = useToolsetVersion(own?.id ?? null, own ? latest : null);
  const update = useUpdateAccess(target.access?.access.agentId ?? null);
  const tools = usePublicTools();
  const priceOf = (name: string) => priceOfTool(tools.data?.tools ?? [], name);
  const ruleOf =
    before.data && after.data
      ? ruleDetails(before.data.entries, after.data.entries, ruleOfSnapshot)
      : choice.kind === "shared" && fromShared.data && version.data
        ? ruleDetails(fromShared.data.entries, version.data.entries, (e) => e)
        : choice.kind === "link" && fromLink.data && link.data
          ? ruleDetails(fromLink.data.entries, link.data.entries, (e) => e)
          : undefined;
  const [copied, setCopied] = React.useState(false);

  const diff =
    target.diff ??
    (choice.kind === "shared" ? (version.data?.diff ?? null) : choice.kind === "link" ? (link.data?.diff ?? null) : null) ??
    (before.data && after.data ? diffSnapshots(snapshotOfVersion(before.data), snapshotOfVersion(after.data)) : null);
  const loading =
    latest === null ||
    (!diff && (choice.kind === "shared" ? version.isPending : choice.kind === "link" ? link.isPending : before.isPending || after.isPending));
  const parsed = target.url ? parseMcpUrl(target.url) : null;
  const nextUrl = target.toUrl ?? (latest ? buildMcpUrl({ ...choice, version: latest }, parsed?.options ?? { free: false }) : null);
  const allowedAt = target.access ? target.access.access.allowedToolsets.find((t) => t.toolsetId === target.access!.toolsetId)?.version : null;

  const handOut = async () => {
    setCopied(true);
    if (!target.agentId || !nextUrl) return;
    try {
      await recordConnectUrl(target.agentId, { url: nextUrl, ...(target.serverName ? { serverName: target.serverName } : {}) });
    } catch {
      // Bookkeeping only: the URL is copied either way.
    }
    void queryClient.invalidateQueries({ queryKey: toolsetKeys.servers(target.agentId) });
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{latest ? `${target.name} v${latest} is out` : `A new version of ${target.name}`}</SheetTitle>
        <SheetDescription>You use v{target.from}. Nothing changes for your agent until you choose to.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-[18px] pb-5 pt-3" data-testid="update-sheet">
        <section className="flex flex-col gap-2">
          <h3 className="text-label-13 text-01">What changed since v{target.from}</h3>
          {loading ? <Skeleton className="h-16 w-full" /> : diff ? <DiffView diff={diff} priceOf={priceOf} ruleOf={ruleOf} /> : <p className="text-body-13 text-02">What changed could not be loaded.</p>}
        </section>

        {nextUrl ? (
          <section className="flex flex-col gap-2 rounded-lg border border-01 p-3">
            <h3 className="text-label-13 text-01">Your app&apos;s URL</h3>
            <p className="text-body-xs text-03">Changes what your app connects to. Your app still uses v{target.from} until you replace it.</p>
            <CopyLine value={nextUrl} label={`Copy v${latest} URL`} onCopied={() => void handOut()} testId="update-copy" />
            {copied ? (
              <p className="text-body-13 text-success-700" aria-live="polite">
                Copied. Replace the old URL in your app{target.serverName ? ` (server “${target.serverName}”)` : ""}
                {target.agentId ? "; Servers in use waits for the first call through it." : "."}
              </p>
            ) : null}
          </section>
        ) : null}

        {target.access ? (
          <section className="flex flex-col gap-2 rounded-lg border border-01 p-3">
            <h3 className="text-label-13 text-01">What this agent may use</h3>
            <p className="text-body-xs text-03">
              {`Changes what the agent is allowed to call, on every server. Today it may use the tools of v${allowedAt ?? target.from}; your app's URL does not change.`}
            </p>
            <Button
              className="self-start"
              loading={update.isPending}
              disabled={!latest}
              onClick={() =>
                latest &&
                update.mutate(moveLockBody(target.access!.access, target.access!.toolsetId, latest, target.name), {
                  onSuccess: () => {
                    toast.success(`This agent may now use ${target.name} v${latest}`, { description: "Update your app's URL too, so it lists the same tools." });
                    onDone();
                  },
                })
              }
            >
              Let this agent use v{latest ?? "…"}&apos;s tools
            </Button>
          </section>
        ) : null}

        <Button variant="secondary" className="self-start" onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}

/**
 * The update alert's landing: `/agents?update=1&from=2&to=3#url=<the v3 URL>`
 * opens the update in place, in the signed-in app (the URL rides in the
 * fragment, so a link-only token never reaches a server log).
 */
export function readUpdateLink(search: string, hash: string): UpdateTarget | null {
  const query = new URLSearchParams(search);
  if (query.get("update") !== "1") return null;
  const from = Number(query.get("from"));
  const to = Number(query.get("to"));
  const url = new URLSearchParams(hash.replace(/^#/, "")).get("url");
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || !url) return null;
  const origin = url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+).*$/i, "$1");
  const choice = parseMcpUrl(url, origin)?.choice;
  if (!choice || (choice.kind !== "shared" && choice.kind !== "link")) return null;
  const name = choice.kind === "shared" ? `@${choice.handle}/${choice.slug}` : "This tool set";
  return { choice: { ...choice, version: from }, name, from, to, toUrl: url };
}

export function UpdateFromAlert() {
  const [target, setTarget] = React.useState<UpdateTarget | null>(null);
  React.useEffect(() => setTarget(readUpdateLink(window.location.search, window.location.hash)), []);
  return <UpdateSheet target={target} onOpenChange={(open) => !open && setTarget(null)} />;
}
