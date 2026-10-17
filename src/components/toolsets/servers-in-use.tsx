"use client";

import { Plus, Server, TriangleAlert } from "lucide-react";
import * as React from "react";

import { SkeletonRows } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { SHOW_ALL_TOOL_BUDGET, tokensText } from "@/features/toolsets/preview";
import type { ServerInUse } from "@/services/toolsets.service";

import { ConnectSheet } from "./connect-sheet";
import { errorText, useAgentServers } from "./use-toolsets";

/**
 * Agent › Servers in use (design spec §7.10): read-only, one row per MCP URL
 * the agent called or was handed in the last 30 days — name, tool count,
 * tokens, last call. A URL handed out with no call yet is "Waiting for the
 * first call". Connect opens the Connect sheet; Change reopens it from the
 * row's URL (the result is a new URL to paste in place of the old one).
 */
const POLL_MS = 10_000;

export function ServersInUse({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [sheet, setSheet] = React.useState<{ url: string | null; changing: boolean } | null>(null);
  const [poll, setPoll] = React.useState<number | false>(false);
  const query = useAgentServers(agentId, { pollMs: poll });
  const servers = query.data?.servers ?? [];
  const waiting = servers.some((s) => s.waitingForFirstCall);
  React.useEffect(() => setPoll(waiting ? POLL_MS : false), [waiting]);
  const shownInFull = servers.reduce((sum, s) => sum + (s.toolCount ?? 0), 0);

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="servers-in-use">
      {query.isPending ? (
        <SkeletonRows rows={2} />
      ) : query.isError ? (
        <p className="flex flex-wrap items-center gap-2 text-body-13 text-02">
          Servers in use could not be loaded ({errorText(query.error)}).
          <button type="button" className="font-semibold text-primary-600 hover:underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : servers.length === 0 ? (
        <p className="text-body-13 text-02">No server yet: connect {agentName} to choose what it uses.</p>
      ) : (
        <>
          {query.data?.overBudget ? (
            <p role="status" className="flex items-start gap-2 rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="servers-over-budget">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                These servers show {shownInFull} tools between them, more than {SHOW_ALL_TOOL_BUDGET}. Agents pick tools less accurately past that:
                change a server to a tool set or to only the tools it needs.
              </span>
            </p>
          ) : null}
          <div className="w-full overflow-x-auto rounded-lg border border-01">
            <table className="w-full min-w-[520px] text-left text-body-13">
              <thead className="bg-02 text-label-xs text-03">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Tools</th>
                  <th scope="col" className="px-3 py-2 font-medium">Tokens</th>
                  <th scope="col" className="px-3 py-2 font-medium">Last call</th>
                  <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Change</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-01">
                {servers.map((server) => (
                  <ServerRow key={server.canonicalUrl} server={server} onChange={() => setSheet({ url: server.canonicalUrl, changing: true })} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Button size="sm" variant={servers.length === 0 ? "primary" : "secondary"} icon={<Plus />} className="self-start" onClick={() => setSheet({ url: null, changing: false })}>
        Connect
      </Button>
      <ConnectSheet
        open={sheet !== null}
        onOpenChange={(open) => !open && setSheet(null)}
        agentId={agentId}
        initialUrl={sheet?.url ?? null}
        changing={sheet?.changing ?? false}
      />
    </div>
  );
}

function ServerRow({ server, onChange }: { server: ServerInUse; onChange: () => void }) {
  return (
    <tr data-testid="server-row" className="align-top">
      <td className="max-w-[260px] px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-label-13 text-01">
          <Server aria-hidden="true" className="size-3.5 shrink-0 text-03" />
          {server.name}
          {server.serverName && server.serverName !== server.name ? <span className="text-body-xs text-03">({server.serverName})</span> : null}
        </span>
        <span className="block break-all font-mono text-mono-xs text-03">{server.canonicalUrl}</span>
      </td>
      <td className="px-3 py-2.5 tabular-nums text-01">{server.available ? (server.toolCount ?? "~") : <span className="text-warning-700">No longer serves</span>}</td>
      <td className="px-3 py-2.5 tabular-nums text-02">{server.available && server.estimatedTokens !== null ? tokensText(server.estimatedTokens) : "—"}</td>
      <td className="px-3 py-2.5 text-02">
        {server.waitingForFirstCall ? (
          <span className="inline-flex items-center gap-1.5 text-primary-700" data-testid="server-waiting">
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-primary-500 motion-reduce:animate-none" />
            Waiting for the first call
          </span>
        ) : server.lastCallAt ? (
          <UtcTime value={server.lastCallAt} relative />
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <button type="button" className="text-label-13 text-primary-600 hover:underline" onClick={onChange}>
          Change
        </button>
      </td>
    </tr>
  );
}
