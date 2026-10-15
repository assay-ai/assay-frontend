"use client";

import { useQuery } from "@tanstack/react-query";

import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { usePenaltySummary } from "@/features/provider-penalties/use-penalty-summary";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { listSlaWindows } from "@/services/provider-sla-windows.service";

import { needsActionItems } from "./needs-action";
import { useProviderBindings } from "./use-listing-progress";

/**
 * "Needs action", read the same way on Home and in the Inbox, so both pages
 * name the same items and the same count.
 */
export function useProviderNeedsAction() {
  const bindings = useProviderBindings();
  const stake = useStakeStatus();
  const penalties = usePenaltySummary();
  const names = useProviderToolNames();

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
    openWindows: openWindows.data?.items ?? [],
    bindings: items,
    stake: { enough: items.some((b) => b.pricingMode !== "FREE") ? stake.enough : true, shortfall: stake.shortfall },
    label: names.bindingLabel,
  });

  return { attention, loading: penalties.isLoading };
}
