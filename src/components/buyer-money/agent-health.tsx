"use client";

import Link from "next/link";
import * as React from "react";

import { relativeTime } from "@/components/g31/format";
import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import type { AgentReadiness } from "@/features/buyer-money/agent-readiness";
import { permissionExpiry } from "@/features/buyer-money/permission-expiry";
import { cn } from "@/utils";

import { useAgentsAndKeys } from "./use-agents";

/**
 * "Is my agent working right now?" — the agent's state in one line: what it
 * means for calls, and when it last called.
 */
export function AgentHealthLine({ readiness, className }: { readiness: AgentReadiness; className?: string }) {
  return (
    <p className={cn("text-body-13 text-02", className)} data-testid="agent-health">
      {readiness.sentence}
      {readiness.lastCallAt ? <span className="text-03"> · last call {relativeTime(readiness.lastCallAt)}</span> : null}
    </p>
  );
}

/** Overview: one row per agent, linking to its card on Agents & keys. */
export function AgentHealthList({ className }: { className?: string }) {
  const data = useAgentsAndKeys({ pollMs: 30_000 });
  const [now] = React.useState(() => Date.now());
  if (data.agentsQuery.isError) {
    return <PageState kind="error" title="Your agents' status could not be loaded" onRetry={() => void data.agentsQuery.refetch()} className={className} />;
  }
  if (data.agentsQuery.isPending || data.agents.length === 0) return null;
  return (
    <section aria-label="Your agents" className={cn("flex w-full flex-col rounded-xl border border-01 bg-01 shadow-hair", className)}>
      <header className="flex items-center justify-between gap-3 px-4 pb-1 pt-3.5 tablet:px-5">
        <h2 className="text-label-md text-01">Your agents</h2>
        <Link href="/agents" className="text-label-13 text-primary-600 hover:underline">
          Manage
        </Link>
      </header>
      <ul className="flex flex-col divide-y divide-01">
        {data.agents.map((agent) => {
          const readiness = data.readiness[agent.agentId];
          if (!readiness) return null;
          // Its permission to pay ends within a week: say so here, with the way to renew it.
          const expiry = permissionExpiry(readiness.grant, now);
          return (
            <li key={agent.agentId} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 tablet:px-5">
              <span className="min-w-0 flex-1">
                <span className="block text-label-13 text-01">{agent.label ?? "Agent"}</span>
                <AgentHealthLine readiness={readiness} className="text-body-xs" />
                {expiry ? (
                  <span className="block text-body-xs text-warning-700" data-testid="overview-permission-expiry">
                    Its permission to pay ends {expiry.label}; then paid calls are refused.
                  </span>
                ) : null}
              </span>
              {expiry ? (
                <>
                  <StatusChip status="expires-soon" detail={expiry.label} />
                  <Link
                    href="/agents"
                    className="text-label-13 font-semibold text-primary-600 hover:underline"
                  >
                    Renew
                  </Link>
                </>
              ) : (
                <StatusChip status={readiness.status} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
