"use client";

import { CircleCheck, KeyRound, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { NEW_KEY_PAYS_NOTE, createKeyErrorText, useCreateKey } from "@/components/buyer-money/create-key";
import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import { useAgentsAndKeys } from "@/components/buyer-money/use-agents";
import { CopyChip } from "@/components/patterns/copy-chip";
import { ConnectSheet } from "@/components/toolsets/connect-sheet";
import { useAgentServers, useRecordConnect } from "@/components/toolsets/use-toolsets";
import { Button } from "@/components/ui/button";
import { keyOfAgent } from "@/features/buyer-money/agent-label";
import { keyForHint } from "@/features/buyer-money/mcp-config";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import { buildMcpUrl, parseMcpUrl } from "@/features/connect/mcp-url";

import { relativeTime } from "./format";

/**
 * Controls › Connect: the first run. One decision and three clicks — a key, a
 * client tab, Copy — always for Everything (`/`):
 *
 *   - no key yet: step 1 is "Create your first key", and the config then
 *     carries the full key (the only moment it exists);
 *   - a key already: the config names it by its prefix, with "Create a key
 *     and fill it in" one click away instead of editing a placeholder.
 *
 * "Is it working?" follows the URL this page hands out (Servers in use, so
 * `?connect=waiting` shows the wait), else the keys' last use. Anything
 * narrower (a tool set, only some tools) is the Connect sheet, one click away.
 *
 * `/connect?tools=a,b` ("Use this tool" on a tool page, also after sign-in)
 * opens the sheet at once with "Only these tools" chosen.
 */

/** `?tools=` as the sheet's prefill URL, or null when it names no readable tool. */
export function toolsPrefillUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get("tools");
  if (!raw) return null;
  const tools = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tools.length === 0) return null;
  const url = buildMcpUrl({ kind: "tools", tools });
  // Only names the sheet can read; anything else opens nothing.
  return parseMcpUrl(url)?.choice.kind === "tools" ? url : null;
}
const POLL_MS = 5_000;

export function ConnectView() {
  const [poll, setPoll] = React.useState<number | false>(POLL_MS);
  const data = useAgentsAndKeys({ pollMs: poll });
  const [narrowing, setNarrowing] = React.useState(false);
  const [prefill, setPrefill] = React.useState<string | null>(null);
  React.useEffect(() => {
    const url = toolsPrefillUrl(window.location.search);
    if (url) {
      setPrefill(url);
      setNarrowing(true);
    }
  }, []);
  const agent = data.agents[0] ?? null;
  const servers = useAgentServers(agent?.agentId, { pollMs: poll });
  const live = data.agents
    .flatMap((a) => data.keys[a.agentId] ?? [])
    .filter((k) => !k.revokedAt)
    .sort((a, b) => ((a.lastUsedAt ?? "") < (b.lastUsedAt ?? "") ? 1 : -1));
  // The key made here, in memory only: never stored, never in the URL.
  const [created, setCreated] = React.useState<{ token: string; prefix: string; name: string } | null>(null);
  const create = useCreateKey(agent?.agentId ?? null, agent ? (data.keys[agent.agentId] ?? []).length : 0, setCreated);

  // The URL this page hands out: its own row under Servers in use, when it has one.
  const root = servers.data?.servers.find((s) => parseMcpUrl(s.canonicalUrl)?.choice.kind === "everything") ?? null;
  const used = live.find((k) => k.lastUsedAt) ?? null;
  const rootCalled = Boolean(root && (root.firstCallAt || root.lastCallAt));
  const waitingOnRoot = Boolean(root?.waitingForFirstCall);
  const done = waitingOnRoot ? false : rootCalled || Boolean(used);
  React.useEffect(() => setPoll(done ? false : POLL_MS), [done]);
  const failed = data.agentsQuery.isError || data.keysQuery.isError;
  const recordConnect = useRecordConnect(agent?.agentId);
  const firstTime = !data.keysQuery.isPending && live.length === 0 && !created;
  const url = mcpEndpointUrl();

  return (
    <div className="flex w-full justify-center px-4 py-4 tablet:px-7 tablet:py-[34px]">
      <div className="flex w-full min-w-0 max-w-[820px] flex-col gap-5 rounded-xl border border-01 bg-01 p-4 tablet:p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-heading-md text-01">Connect your agent</h1>
          <p className="text-body-md text-02">One MCP address and one key. Your agent lists the tools and sees each price.</p>
        </header>

        {firstTime ? (
          <section className="flex flex-col gap-3 rounded-lg border border-primary-20 bg-primary-10 p-4" data-testid="connect-first-key">
            <h2 className="flex items-center gap-2 text-label-sm text-01">
              <KeyRound aria-hidden="true" className="size-4" />
              Step 1: create your first key
            </h2>
            <p className="text-body-13 text-02">Your agent uses it to call tools. The config below then carries it, ready to paste.</p>
            <Button className="self-start" loading={create.isPending} disabled={!agent} onClick={() => create.mutate()}>
              Create your first key
            </Button>
            {create.isError ? <p className="text-body-13 text-danger-700">{createKeyErrorText(create.error)}</p> : null}
          </section>
        ) : null}

        {created ? (
          <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-warning-20 bg-warning-10 p-3" data-testid="connect-key-created">
            <span className="flex items-center gap-1.5 text-label-13 text-warning-700">
              <TriangleAlert aria-hidden="true" className="size-3.5" />
              Your key, shown once: it is in the config below. Copy it now.
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-mono-12 text-01">{created.token}</code>
              <CopyChip value={created.token} display="Copy" label="your key" />
            </div>
            <p className="text-body-xs text-02">{NEW_KEY_PAYS_NOTE}</p>
          </div>
        ) : null}

        <div className={firstTime ? "pointer-events-none opacity-50" : undefined} aria-hidden={firstTime || undefined}>
          {firstTime ? <p className="pb-2 text-label-13 text-01">Step 2: paste this into your client</p> : null}
          <McpConfigTabs
            token={created?.token ?? null}
            keyPrefix={created?.prefix ?? keyForHint(live)?.prefix ?? null}
            url={url}
            onCopy={(client) => agent && recordConnect.mutate({ url, serverName: "assay", client })}
            onCreateKey={!firstTime && agent ? () => create.mutate() : undefined}
            creatingKey={create.isPending}
            createKeyError={!firstTime && create.isError ? createKeyErrorText(create.error) : null}
          />
        </div>

        <p className="text-body-13 text-02">
          This connects Everything: every tool on Assay, through one server.{" "}
          {agent ? (
            <button type="button" className="min-h-10 font-semibold text-primary-600 hover:underline" onClick={() => setNarrowing(true)}>
              Connect a tool set or only some tools
            </button>
          ) : null}
        </p>

        <section aria-label="Connection check" className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-4">
          <h2 className="text-label-sm text-01">Is it working?</h2>
          {failed ? (
            <p className="text-body-13 text-02">We could not check your keys just now. This does not mean your config is wrong.</p>
          ) : done ? (
            <p className="flex items-center gap-2 text-body-13 text-success-700" data-testid="connect-working">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-500" />
              {rootCalled && root?.lastCallAt
                ? `Yes: the first call arrived; the last one ${relativeTime(root.lastCallAt)}.`
                : `Yes: ${keyOfAgent(used?.name ?? "", agent?.label)} made a call ${relativeTime(used?.lastUsedAt ?? null)}.`}
            </p>
          ) : live.length === 0 && !created ? (
            <p className="text-body-13 text-02">Create a key and paste the config first.</p>
          ) : (
            <p className="flex items-center gap-2 text-body-13 text-02" aria-live="polite" data-testid="connect-waiting">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary-500 motion-reduce:animate-none" />
              Waiting for your agent&apos;s first call. Paste the config, restart your client and ask it to use a tool. This updates by itself.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="secondary" size="sm" className="min-h-10" asChild>
              <Link href="/agents">Keys and servers in use</Link>
            </Button>
          </div>
        </section>
      </div>
      <ConnectSheet
        open={narrowing}
        onOpenChange={(open) => {
          setNarrowing(open);
          // Closed: the preselection was used once; a later "Connect a tool set" starts fresh.
          if (!open && prefill) {
            setPrefill(null);
            // Only `tools` goes: other parameters and the hash stay.
            const next = new URL(window.location.href);
            next.searchParams.delete("tools");
            window.history.replaceState(window.history.state, "", next);
          }
        }}
        agentId={agent?.agentId ?? null}
        initialUrl={prefill}
      />
    </div>
  );
}
