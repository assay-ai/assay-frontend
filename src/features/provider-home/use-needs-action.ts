"use client";

import { useQuery } from "@tanstack/react-query";

import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { usePenaltySummary } from "@/features/provider-penalties/use-penalty-summary";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { listProviderCallDisputes } from "@/services/call-disputes.service";
import { listSlaWindows } from "@/services/provider-sla-windows.service";

import { needsActionItems, slaWatchItems } from "./needs-action";
import { useProviderBindings } from "./use-listing-progress";

/**
 * Open bad-result reports on the provider's calls, read once for Home, the
 * Inbox and the nav badge (same query key).
 */
export function useOpenReports() {
  return useQuery({
    queryKey: ["provider", "call-disputes", "open"],
    queryFn: () => listProviderCallDisputes({ state: ["OPEN"], limit: 50 }),
    refetchInterval: 60_000,
    retry: false,
  });
}

/** Reports the provider can still reply to; the badge and "Needs action" count these. */
export function repliableReports(items: readonly { id: string; canRespond: boolean; replyDueAt: string }[], now = Date.now()) {
  return items.filter((report) => report.canRespond && Date.parse(report.replyDueAt) > now);
}

/**
 * "Needs action", read the same way on Home and in the Inbox, so both pages
 * name the same items and the same count. `watch` holds the warnings that need
 * no action yet (a window over the promise below its minimum sample, D20).
 */
export function useProviderNeedsAction() {
  const bindings = useProviderBindings();
  const stake = useStakeStatus();
  const penalties = usePenaltySummary();
  const names = useProviderToolNames();
  const reports = useOpenReports();

  const items = bindings.data?.items ?? [];
  const anyLive = items.some((binding) => binding.status === "ACTIVE");

  const openWindows = useQuery({
    queryKey: ["provider", "sla-windows", "open"],
    queryFn: () => listSlaWindows({ status: "OPEN", limit: 50 }),
    enabled: anyLive,
    retry: false,
  });

  const attention = needsActionItems({
    penalties: penalties.needsAction,
    reports: reports.data?.items ?? [],
    openWindows: openWindows.data?.items ?? [],
    bindings: items,
    stake: {
      enough: items.some((b) => b.pricingMode !== "FREE") ? stake.enough : true,
      shortfall: stake.shortfall,
      required: stake.required,
      staked: stake.staked,
    },
    label: names.bindingLabel,
  });
  const watch = slaWatchItems({ openWindows: openWindows.data?.items ?? [], bindings: items, label: names.bindingLabel });

  return { attention, watch, loading: penalties.isLoading };
}
