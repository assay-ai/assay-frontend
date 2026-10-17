"use client";

import { Server, TriangleAlert } from "lucide-react";
import * as React from "react";

import { SkeletonRows } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { SHOW_ALL_TOOL_BUDGET, tokensText } from "@/features/toolsets/preview";
import { biggestServer, serverLabel, toolsShown } from "@/features/toolsets/servers";
import type { ServerInUse } from "@/services/toolsets.service";

import { ConnectSheet } from "./connect-sheet";
import { errorText, useAgentServers } from "./use-toolsets";

/**
 * Agent › Servers in use (design spec §7.10): read-only, one row per MCP URL
 * the agent called or was handed in the last 30 days — what it serves, tool
 * count, tokens, last call. A URL handed out with no call yet is "Waiting for
 * the first call". Connect opens the Connect sheet; Change reopens it from the
 * row's URL (the result is a new URL to paste in place of the old one).
 *
 * A table from tablet up; stacked cards on a phone, so nothing scrolls sideways.
 */
const POLL_MS = 10_000;

export function ServersInUse({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [sheet, setSheet] = React.useState<{ url: string | null; changing: boolean } | null>(null);
  const [poll, setPoll] = React.useState<number | false>(false);
  const query = useAgentServers(agentId, { pollMs: poll });
  const servers = query.data?.servers ?? [];
  const waiting = servers.some((s) => s.waitingForFirstCall);
  React.useEffect(() => setPoll(waiting ? POLL_MS : false), [waiting]);
  // One source for the count and the warning: the rows shown here.
  const shown = toolsShown(servers);
  const over = shown > SHOW_ALL_TOOL_BUDGET;
  const biggest = over ? biggestServer(servers) : null;
  const change = (server: ServerInUse) => setSheet({ url: server.canonicalUrl, changing: true });
  const clashes = (server: ServerInUse) =>
    Boolean(server.serverName) && servers.some((s) => s.canonicalUrl !== server.canonicalUrl && s.serverName === server.serverName);

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="servers-in-use">
      <p className="text-body-xs text-03">
        The servers {agentName} has called or was given in the last 30 days. Read-only: to change one, make a new URL and replace the old one in your app.
      </p>
      {query.isPending ? (
        <SkeletonRows rows={2} />
      ) : query.isError ? (
        <p className="flex flex-wrap items-center gap-2 text-body-13 text-02">
          Servers in use could not be loaded: {errorText(query.error).replace(/\.$/, "")}.
          <button type="button" className="min-h-10 font-semibold text-primary-600 hover:underline tablet:min-h-0" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : servers.length === 0 ? (
        <p className="text-body-13 text-02">No server yet: connect {agentName} to choose what it uses.</p>
      ) : (
        <>
          {over ? (
            <div role="status" className="flex flex-col gap-2 rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700 tablet:flex-row tablet:items-center" data-testid="servers-over-budget">
              <span className="flex min-w-0 flex-1 items-start gap-2">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  These servers show {shown} tools between them, more than {SHOW_ALL_TOOL_BUDGET}. Agents pick tools less accurately past that.
                </span>
              </span>
              {biggest ? (
                <Button size="sm" variant="secondary" className="self-start tablet:self-center" onClick={() => change(biggest)}>
                  Narrow “{serverLabel(biggest).title}”
                </Button>
              ) : null}
            </div>
          ) : null}

          <p className="text-body-xs text-03 tablet:hidden">Change makes a new URL for a server; replace the old one in your app.</p>
          <ul className="flex flex-col gap-2 tablet:hidden" data-testid="server-cards">
            {servers.map((server) => (
              <ServerCard key={server.canonicalUrl} server={server} clash={clashes(server)} onChange={() => change(server)} />
            ))}
          </ul>

          <div className="hidden w-full rounded-lg border border-01 tablet:block">
            <table className="w-full text-left text-body-13">
              <thead className="bg-02 text-label-xs text-03">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Tools</th>
                  <th scope="col" className="px-3 py-2 font-medium">Tokens (est.)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Last call</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-01">
                {servers.map((server) => (
                  <ServerRow key={server.canonicalUrl} server={server} clash={clashes(server)} onChange={() => change(server)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Button size="sm" variant={servers.length === 0 ? "primary" : "secondary"} className="min-h-10 self-start tablet:min-h-0" onClick={() => setSheet({ url: null, changing: false })}>
        Connect {agentName}
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

function NameCell({ server, clash }: { server: ServerInUse; clash: boolean }) {
  const label = serverLabel(server);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-label-13 text-01">
        <Server aria-hidden="true" className="size-3.5 shrink-0 text-03" />
        <span className="[overflow-wrap:anywhere]">{label.title}</span>
      </span>
      {label.detail ? <span className="text-body-xs text-03 [overflow-wrap:anywhere]">{label.detail}</span> : null}
      {server.serverName ? (
        <span className="text-body-xs text-03">
          In your app: “{server.serverName}”
          {clash ? <span className="text-warning-700"> · another server here has this name too: rename one in your app so their tools do not clash</span> : null}
        </span>
      ) : null}
      <span className="break-all font-mono text-mono-xs text-03">{server.canonicalUrl}</span>
    </span>
  );
}

function LastCall({ server }: { server: ServerInUse }) {
  if (server.waitingForFirstCall) {
    return (
      <span className="inline-flex items-center gap-1.5 text-primary-700" data-testid="server-waiting">
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-primary-500 motion-reduce:animate-none" />
        Waiting for the first call
      </span>
    );
  }
  return server.lastCallAt ? <UtcTime value={server.lastCallAt} relative /> : <>—</>;
}

function Tools({ server }: { server: ServerInUse }) {
  return server.available ? <>{server.toolCount ?? "~"}</> : <span className="text-warning-700">No longer serves</span>;
}

function Tokens({ server }: { server: ServerInUse }) {
  return <>{server.available && server.estimatedTokens !== null ? tokensText(server.estimatedTokens) : "—"}</>;
}

function ServerRow({ server, clash, onChange }: { server: ServerInUse; clash: boolean; onChange: () => void }) {
  return (
    <tr data-testid="server-row" className="align-top">
      <td className="max-w-[320px] px-3 py-2.5">
        <NameCell server={server} clash={clash} />
      </td>
      <td className="px-3 py-2.5 tabular-nums text-01">
        <Tools server={server} />
      </td>
      <td className="px-3 py-2.5 tabular-nums text-02">
        <Tokens server={server} />
      </td>
      <td className="px-3 py-2.5 text-02">
        <LastCall server={server} />
      </td>
      <td className="px-3 py-2.5 text-right">
        <button type="button" className="text-label-13 text-primary-600 hover:underline" onClick={onChange} title="Makes a new URL to replace this one in your app">
          Change…
        </button>
      </td>
    </tr>
  );
}

function ServerCard({ server, clash, onChange }: { server: ServerInUse; clash: boolean; onChange: () => void }) {
  return (
    <li data-testid="server-card" className="flex min-w-0 flex-col gap-2 rounded-lg border border-01 p-3">
      <NameCell server={server} clash={clash} />
      <dl className="grid grid-cols-3 gap-2 text-body-xs">
        <div>
          <dt className="text-03">Tools</dt>
          <dd className="tabular-nums text-01">
            <Tools server={server} />
          </dd>
        </div>
        <div>
          <dt className="text-03">Tokens (est.)</dt>
          <dd className="tabular-nums text-02">
            <Tokens server={server} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-03">Last call</dt>
          <dd className="text-02">
            <LastCall server={server} />
          </dd>
        </div>
      </dl>
      <Button size="sm" variant="secondary" className="min-h-10 w-full" onClick={onChange}>
        Change…
      </Button>
    </li>
  );
}
