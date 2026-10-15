"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import {
  accessSummary,
  blockSwitchesToList,
  nextAllowedTools,
  toolAccess,
} from "@/features/explorer/tool-access";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { getSpendPolicyTyped, updateSpendPolicy, type SpendPolicy } from "@/services/limits.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

/**
 * The spend policy as Budgets reads it (same query key, so a change here shows
 * on /limits at once and the other way round). `null` = no policy yet.
 */
export function useSpendPolicy() {
  return useQuery({
    queryKey: ["spend-policy"],
    retry: false,
    queryFn: async (): Promise<SpendPolicy | null> => {
      try {
        return await getSpendPolicyTyped();
      } catch (error) {
        if (error instanceof ApiError && error.code === "SPEND_POLICY_NOT_FOUND") return null;
        throw error;
      }
    },
  });
}

/**
 * Allow / Block one tool for every agent on the account, inline. Blocking from
 * "every tool allowed" first says that new tools will then need allowing.
 */
export function ToolAccessControl({
  toolId,
  toolName,
  allToolIds,
  className,
}: {
  toolId: string;
  toolName: string;
  allToolIds: readonly string[];
  className?: string;
}) {
  const queryClient = useQueryClient();
  const policy = useSpendPolicy();
  const [confirming, setConfirming] = React.useState(false);

  const mutation = useMutation({
    mutationFn: (vars: { allowedTools: string[] | null; allow: boolean }) =>
      updateSpendPolicy({
        allowedTools: vars.allowedTools,
        changeReason: `${vars.allow ? "Allowed" : "Blocked"} ${toolName} from Explore`,
      }),
    onSuccess: (next, vars) => {
      queryClient.setQueryData(["spend-policy"], next);
      void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
      toast.success(`${toolName} ${vars.allow ? "allowed" : "blocked"} for your agents`, {
        description: accessSummary(next.allowedTools, allToolIds.length),
      });
    },
  });

  if (policy.isPending) return <span className={cn("h-8 w-[150px] animate-pulse rounded-md bg-03", className)} />;
  if (policy.isError) return null;
  if (policy.data === null) {
    return (
      <Link href="/limits" className={cn("text-label-13 text-primary-600 hover:underline", className)}>
        Set a budget to allow or block tools
      </Link>
    );
  }

  const current = policy.data.allowedTools;
  const access = toolAccess(current, toolId);

  function change(allow: boolean) {
    const next = nextAllowedTools(current, allToolIds, toolId, allow);
    if (next === undefined) return;
    if (!allow && blockSwitchesToList(current)) {
      setConfirming(true);
      return;
    }
    mutation.mutate(
      { allowedTools: next, allow },
      { onError: (error) => toast.error(error instanceof ApiError ? plainError(error.code) : "The change could not be saved") },
    );
  }

  return (
    <>
      <div role="group" aria-label={`Can your agents use ${toolName}?`} className={cn("inline-flex rounded-md bg-03 p-0.5", className)}>
        {([true, false] as const).map((allow) => {
          const active = (access === "allowed") === allow;
          return (
            <button
              key={String(allow)}
              type="button"
              aria-pressed={active}
              disabled={mutation.isPending}
              onClick={() => change(allow)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-label-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60",
                active
                  ? allow
                    ? "bg-01 text-success-700"
                    : "bg-01 text-danger-700"
                  : "text-02 hover:text-01",
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
        title={`Block ${toolName} for your agents?`}
        description="Your agents can use every tool today. Blocking one switches you to a list of allowed tools: tools listed on Assay later are not allowed until you allow them, here or in Spending limits."
        changes={[
          { label: toolName, before: "Allowed", after: "Blocked" },
          { label: "New tools", before: "Allowed", after: "Need allowing" },
        ]}
        confirmLabel={`Block ${toolName}`}
        onConfirm={() =>
          mutation.mutateAsync({ allowedTools: nextAllowedTools(current, allToolIds, toolId, false) ?? [], allow: false })
        }
        describeError={(error) => (error instanceof ApiError ? plainError(error.code) : "The change could not be saved")}
      />
    </>
  );
}
