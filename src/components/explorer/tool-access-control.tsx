"use client";

import { useQuery } from "@tanstack/react-query";
import { Ban, Check } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { useAgentAccess, useUpdateAccess } from "@/components/toolsets/use-toolsets";
import { accessSummary, blockSwitchesToList, nextAccessBody, toolAccess } from "@/features/explorer/tool-access";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { listAgents } from "@/services/account.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

/**
 * The agent Explore's Allow / Block speaks for: the account's first agent,
 * named on the control. What an agent can use is per agent now; with several
 * agents, the others are changed on the Agents page.
 */
export function useExploreAgent() {
  const agents = useQuery({
    queryKey: ["agents"],
    retry: false,
    queryFn: () => listAgents({ limit: 50 }) as unknown as Promise<{ items: { agentId: string; label?: string }[] }>,
  });
  const agent = agents.data?.items[0] ?? null;
  const access = useAgentAccess(agent?.agentId);
  return { agent, name: agent?.label ?? "Your agent", access, many: (agents.data?.items.length ?? 0) > 1 };
}

/**
 * Allow / Block one tool for the agent, inline. Blocking from "Everything"
 * first says that new tools will then need allowing.
 */
export function ToolAccessControl({ toolId, toolName, className }: { toolId: string; toolName: string; allToolIds?: readonly string[]; className?: string }) {
  const { agent, name, access } = useExploreAgent();
  const update = useUpdateAccess(agent?.agentId);
  const [confirming, setConfirming] = React.useState(false);

  if (!agent || access.isPending) return <span className={cn("h-8 w-[150px] animate-pulse rounded-md bg-03", className)} />;
  if (access.isError || !access.data) return null;

  const current = access.data;
  const standing = toolAccess(current, toolId);
  if (standing === "via-toolset") {
    return (
      <Link
        href={`/agents?agent=${encodeURIComponent(agent.agentId)}#access`}
        className={cn("text-label-13 text-02 hover:underline", className)}
      >
        Allowed through a tool set&apos;s URL
      </Link>
    );
  }

  function save(allow: boolean) {
    const body = nextAccessBody(current, toolId, toolName, allow);
    if (!body) return Promise.resolve();
    return update.mutateAsync(body).then((next) => {
      toast.success(`${toolName} ${allow ? "allowed" : "blocked"} for ${name}`, { description: accessSummary(next, name) });
    });
  }

  function change(allow: boolean) {
    if (!allow && blockSwitchesToList(current)) {
      setConfirming(true);
      return;
    }
    void save(allow).catch(() => undefined);
  }

  return (
    <>
      <div role="group" aria-label={`Can ${name} use ${toolName}?`} className={cn("inline-flex rounded-md bg-03 p-0.5", className)}>
        {([true, false] as const).map((allow) => {
          const active = (standing === "allowed") === allow;
          return (
            <button
              key={String(allow)}
              type="button"
              aria-pressed={active}
              disabled={update.isPending}
              onClick={() => change(allow)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-label-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60",
                active ? (allow ? "bg-01 text-success-700" : "bg-01 text-danger-700") : "text-02 hover:text-01",
              )}
            >
              {allow ? <Check aria-hidden="true" className="size-3.5" /> : <Ban aria-hidden="true" className="size-3.5" />}
              {allow ? "Allowed" : "Blocked"}
            </button>
          );
        })}
      </div>
      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title={`Block ${toolName} for ${name}?`}
        description={`${name} can use every tool today. Blocking one switches it to Only these tools: tools listed on Assay later are not allowed until you allow them, here or under What this agent can use.`}
        changes={[
          { label: toolName, before: "Allowed", after: "Blocked" },
          { label: "New tools", before: "Allowed", after: "Need allowing" },
        ]}
        confirmLabel={`Block ${toolName}`}
        onConfirm={() => save(false)}
        describeError={(error) => (error instanceof ApiError ? plainError(error.code) : "The change could not be saved")}
      />
    </>
  );
}
