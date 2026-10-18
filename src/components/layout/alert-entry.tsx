"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Info, TriangleAlert } from "lucide-react";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { useSpendPolicyQuery } from "@/components/buyer-money/use-agents";
import { alertTitle, isOldLimitAlert, type AlertNote, type LimitContext } from "@/features/buyer/alert-model";
import { attentionAction, type AttentionAction } from "@/features/buyer/attention-action";
import { supportsDelegation } from "@/features/delegation/delegation-form";
import { notificationTitle } from "@/features/toolsets/contract-notices";
import { listAgents, markNotificationRead } from "@/services/account.service";
import { cn } from "@/utils";

/**
 * One alert as a row: the bell's renderer, also used by "See all alerts", so
 * both say the same thing — title (with "(old limit)" when the limit it names
 * has changed), when, and the one thing to do.
 */

export interface AlertEntryNote extends AlertNote {
  severity: "INFO" | "WARNING" | "CRITICAL" | string;
}

export const ALERT_ICON: Record<string, React.ReactNode> = {
  INFO: <Info aria-hidden="true" className="size-4 text-primary-500" />,
  WARNING: <Gauge aria-hidden="true" className="size-4 text-warning-500" />,
  CRITICAL: <TriangleAlert aria-hidden="true" className="size-4 text-danger-500" />,
};

export interface PresentedAlert {
  title: string;
  action: AttentionAction | null;
}

/** Title and action, the way every alert surface shows them. */
export function presentAlert(note: AlertEntryNote, limits: LimitContext): PresentedAlert {
  return {
    title: alertTitle(notificationTitle(note), isOldLimitAlert(note, limits)),
    action: attentionAction(note),
  };
}

export function AlertEntry({ note, limits, unread }: { note: AlertEntryNote; limits: LimitContext; unread: boolean }) {
  const { title, action } = presentAlert(note, limits);
  return (
    <span className="flex w-full items-start gap-2.5">
      <span className="mt-0.5 shrink-0">{ALERT_ICON[note.severity] ?? ALERT_ICON.INFO}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-body-13", unread ? "font-medium text-01" : "text-02")}>{title}</span>
        <span className="text-body-xs text-03">
          <UtcTime value={note.createdAt} relative />
          {action ? ` · ${action.label}` : ""}
        </span>
      </span>
    </span>
  );
}

/**
 * What "(old limit)" is judged against: the spend policy `GET /spend-policy`
 * answers, the agent it applies to, and whether that agent pays through an
 * on-chain permission. Unknown while loading or on error — then nothing is
 * marked.
 */
export function useAlertLimitContext(enabled = true): LimitContext {
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    enabled,
    retry: false,
    queryFn: () => listAgents({ limit: 50 }) as unknown as Promise<{ items: { agentId: string; agentAccount?: string }[] }>,
  });
  const policyQuery = useSpendPolicyQuery({ enabled });
  return React.useMemo(() => {
    const agents = agentsQuery.data?.items ?? [];
    const policy = policyQuery.data ?? null;
    const agentId =
      policy?.agentId && agents.some((a) => a.agentId === policy.agentId)
        ? policy.agentId
        : agents.length === 1
          ? agents[0]!.agentId
          : null;
    const agent = agents.find((a) => a.agentId === agentId);
    return { policy, policyAgentId: agentId, delegation: supportsDelegation(agent?.agentAccount) };
  }, [agentsQuery.data, policyQuery.data]);
}

/**
 * Marks alerts read (`PATCH /notifications/:id/read`, the person's session
 * only), then refreshes the badge and every alert list.
 */
export function useMarkAlertsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      await Promise.all(ids.map((id) => markNotificationRead(id)));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
