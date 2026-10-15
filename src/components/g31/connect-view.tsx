"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheck, KeyRound, Play } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import { listAgents, listCredentials } from "@/services/account.service";

import { PageHeader } from "./chrome";
import { relativeTime } from "./format";

/**
 * Connect your agent.
 *
 * The first-run path: one MCP URL and one credential. The design is explicit
 * that the agent calls `tools/list` and sees every tool with its price already
 * attached — there is nothing to configure here, which is why this screen has
 * no tool list on it.
 *
 * The config block is assembled from the real credential list: the prefix of
 * the agent's newest live credential goes into the `Authorization` header, and
 * the "Confirm it is live" row reads that credential's `lastUsedAt`. That row
 * is the whole point of the screen — it is the only place in the product that
 * answers "did my config actually work?" — and it answers it from data rather
 * than from an assumption.
 *
 * The secret itself is never here. It is returned exactly once, at creation
 * (the "Credential created" reveal), so only the clear-text prefix can be shown and the config block
 * says so.
 *
 * The MCP endpoint URL comes from `NEXT_PUBLIC_MCP_URL` (`mcpEndpointUrl`); no
 * API endpoint reports it, so an unconfigured build renders a named
 * placeholder rather than a guess — a wrong URL in a copy-paste block costs
 * somebody an afternoon.
 */

interface Agent {
  agentId: string;
  label?: string;
}

interface Credential {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const QUOTAS = [
  { value: "1,000", label: "free calls per day", sub: "no deposit needed to start" },
  { value: "60", label: "calls per minute", sub: "raised on request" },
  { value: "$0.00", label: "balance required", sub: "the free tier is the first-run path" },
];

export function ConnectView() {
  const agents = useQuery({
    queryKey: ["agents"],
    retry: false,
    queryFn: () => listAgents({ limit: 50 }) as unknown as Promise<{ items: Agent[] }>,
  });

  const agentList = React.useMemo(() => agents.data?.items ?? [], [agents.data]);

  const agentIds = React.useMemo(() => agentList.map((agent) => agent.agentId), [agentList]);

  /** One observer across every agent — see the note in `agents-view.tsx`. */
  const credentialsQuery = useQuery({
    queryKey: ["credentials", agentIds],
    retry: false,
    enabled: agentIds.length > 0,
    queryFn: async () => {
      const lists = await Promise.all(
        agentIds.map(
          (id) => listCredentials(id, { limit: 50 }) as Promise<{ items: Credential[] }>
        )
      );
      return lists.flatMap((list) => list.items);
    },
  });

  const live = React.useMemo(() => {
    const all = credentialsQuery.data ?? [];
    return all
      .filter((c) => !c.revokedAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }, [credentialsQuery.data]);

  const config = `"assay": {
  "url": "${mcpEndpointUrl()}",
  "headers": { "Authorization": "Bearer ${live ? `${live.prefix}…` : "<credential>"}" }
}
// This key does not expire. Revoke or rotate it at any time under Agents.`;

  return (
    <div className="flex w-full justify-center px-4 py-8 tablet:px-7 tablet:py-[34px]">
      <div className="flex w-full max-w-[820px] flex-col gap-5 rounded-xl border border-01 bg-01 p-6 tablet:gap-5 tablet:p-8">
        <PageHeader
          title="Connect your agent"
          subtitle={null}
        />
        <p className="text-body-md text-02">
          One MCP URL and one credential. Your agent calls tools/list and sees every tool with its
          price already attached — you do not configure tools here.
        </p>

        <CodeBlock title="mcp.json" code={config} />

        <div className="flex w-full flex-col gap-3.5 tablet:flex-row">
          {QUOTAS.map((quota) => (
            <div
              key={quota.label}
              className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-01 bg-02 p-[18px]"
            >
              <span className="font-mono text-heading-md text-01">{quota.value}</span>
              <span className="text-label-13 text-01">{quota.label}</span>
              <span className="text-body-xs text-03">{quota.sub}</span>
            </div>
          ))}
        </div>

        <div className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-3.5 tablet:p-[15px]">
          <KeyRound aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-primary-600" />
          <p className="text-body-13 text-primary-700">
            This key does not expire. Revoke or rotate it at any time under Agents — revocation is
            immediate, with no grace period and no cached-token window.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-02 p-[18px]">
          <p className="text-label-sm text-01">Confirm it is live</p>
          <div className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center">
            {agents.isError || credentialsQuery.isError ? (
              <p className="flex-1 text-body-13 text-danger-600">
                We could not read your credentials, so this row is not saying your config is
                broken — only that we cannot check it right now.
              </p>
            ) : !live ? (
              <>
                <p className="flex-1 text-body-13 text-02">
                  No live credential yet. Create one under Agents, then paste it into the block
                  above.
                </p>
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/agents">Open Agents</Link>
                </Button>
              </>
            ) : live.lastUsedAt ? (
              <>
                <CircleCheck aria-hidden="true" className="size-[15px] shrink-0 text-success-500" />
                <p className="flex-1 text-body-13 text-success-700">
                  Credential last used {relativeTime(live.lastUsedAt)} — your config is working.
                </p>
                <Button variant="secondary" size="sm" icon={<Play />} type="button" disabled>
                  Run a test call
                </Button>
              </>
            ) : (
              <>
                <p className="flex-1 text-body-13 text-02">
                  {live.prefix}… has never been used. Once your agent makes its first call, this row
                  says so.
                </p>
                <Button variant="secondary" size="sm" icon={<Play />} type="button" disabled>
                  Run a test call
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
