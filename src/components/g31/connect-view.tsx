"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CreateKeySheet } from "@/components/buyer-money/create-key";
import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import { useAgentsAndKeys } from "@/components/buyer-money/use-agents";
import { ConnectSheet } from "@/components/toolsets/connect-sheet";
import { useRecordConnect } from "@/components/toolsets/use-toolsets";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import { Button } from "@/components/ui/button";

import { relativeTime } from "./format";

/**
 * Controls › Connect: the MCP config to paste, per client, and a live check
 * that the agent's calls arrive. The first run is one decision and three
 * clicks: a key, a client tab, Copy — always for Everything (`/`). Anything
 * narrower (a tool set, only some tools) is the Connect sheet, one click away.
 */
const POLL_MS = 5_000;

export function ConnectView() {
  const [poll, setPoll] = React.useState<number | false>(POLL_MS);
  const data = useAgentsAndKeys({ pollMs: poll });
  const [creating, setCreating] = React.useState(false);
  const [narrowing, setNarrowing] = React.useState(false);
  const agent = data.agents[0] ?? null;
  const live = data.agents
    .flatMap((a) => data.keys[a.agentId] ?? [])
    .filter((k) => !k.revokedAt)
    .sort((a, b) => ((a.lastUsedAt ?? "") < (b.lastUsedAt ?? "") ? 1 : -1));
  const used = live.find((k) => k.lastUsedAt) ?? null;
  // Listen until the first call is seen, then stop polling.
  React.useEffect(() => setPoll(used ? false : POLL_MS), [used]);
  const failed = data.agentsQuery.isError || data.keysQuery.isError;
  const recordConnect = useRecordConnect(agent?.agentId);

  return (
    <div className="flex w-full justify-center px-4 py-6 tablet:px-7 tablet:py-[34px]">
      <div className="flex w-full max-w-[820px] min-w-0 flex-col gap-5 rounded-xl border border-01 bg-01 p-5 tablet:p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-heading-md text-01">Connect your agent</h1>
          <p className="text-body-md text-02">
            One MCP address and one key. Your agent lists the tools and sees each price; you do not set up tools here.
          </p>
        </header>

        <McpConfigTabs
          token={null}
          keyPrefix={live[0]?.prefix ?? null}
          onCopy={(client) => agent && recordConnect.mutate({ url: mcpEndpointUrl(), serverName: "assay", client })}
        />

        <p className="text-body-13 text-02">
          This connects Everything: every tool on Assay, through one server.{" "}
          {agent ? (
            <button type="button" className="font-semibold text-primary-600 hover:underline" onClick={() => setNarrowing(true)}>
              Connect a tool set or only some tools
            </button>
          ) : null}
        </p>

        <p className="text-body-13 text-02">
          {live.length === 0 ? "You need a key to paste in. " : "Your key was shown once when you created it. "}
          {agent ? (
            <button type="button" className="font-semibold text-primary-600 hover:underline" onClick={() => setCreating(true)}>
              {live.length === 0 ? "Create a key" : "Create a new key"}
            </button>
          ) : null}
          {live.length > 0 ? " if you no longer have it." : null}
        </p>

        <p className="rounded-lg border border-teal-20 bg-teal-10 px-3.5 py-3 text-body-13 text-teal-600">
          No money needed to start: many tools include free calls every day; the tool list shows how many. Add funds
          when you want paid calls.
        </p>

        <section aria-label="Connection check" className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-4">
          <h2 className="text-label-sm text-01">Is it working?</h2>
          {failed ? (
            <p className="text-body-13 text-02">We could not check your keys just now. This does not mean your config is wrong.</p>
          ) : used ? (
            <p className="flex items-center gap-2 text-body-13 text-success-700">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-500" />
              Yes: “{used.name}” made a call {relativeTime(used.lastUsedAt)}.
            </p>
          ) : live.length === 0 ? (
            <p className="text-body-13 text-02">Create a key and paste the config first.</p>
          ) : (
            <p className="flex items-center gap-2 text-body-13 text-02" aria-live="polite">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary-500 motion-reduce:animate-none" />
              Waiting for your agent&apos;s first call. This updates by itself within a few seconds.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/agents">Manage keys</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/agents">Servers in use</Link>
            </Button>
          </div>
        </section>
      </div>
      <CreateKeySheet agentId={agent?.agentId ?? null} agentName={agent?.label} open={creating} onOpenChange={setCreating} />
      <ConnectSheet open={narrowing} onOpenChange={setNarrowing} agentId={agent?.agentId ?? null} />
    </div>
  );
}
