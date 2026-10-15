"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { SectionTabs } from "@/components/layout/section-tabs";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { Skeleton } from "@/components/patterns/page-state";
import type { BindingStatus, ToolBindingDetail } from "@/interfaces";
import { getToolBinding } from "@/services/provider-tool-bindings.service";
import { labelForEndpoint } from "@/utils/provider-label";

import { overlayJustPublished } from "./after-publish";
import { bindingScreens, type BindingTabId } from "./screens";
import { useProviderToolNames } from "./tool-name";

/** The detail query every binding page shares. */
export function bindingQueryKey(bindingId: string) {
  return ["provider", "tool-binding", bindingId] as const;
}

export function useBinding(bindingId: string, options: { refetchInterval?: number } = {}) {
  return useQuery<ToolBindingDetail>({
    queryKey: bindingQueryKey(bindingId),
    queryFn: () => getToolBinding(bindingId),
    // A read older than a publish this tab just made must not undo it on screen.
    select: overlayJustPublished,
    enabled: Boolean(bindingId),
    retry: 0,
    refetchInterval: options.refetchInterval,
  });
}

export function bindingStatusChip(status: BindingStatus): StatusChipKey {
  switch (status) {
    case "ACTIVE":
      return "live";
    case "PAUSED":
      return "paused";
    case "SUSPENDED":
      return "blocked";
    default:
      return "draft";
  }
}

/**
 * Every binding page's head: the tool's name as the title (never an id),
 * its status, the endpoint as the subtitle (the listing id is on Settings, for support), the page's one
 * primary action, then the three tabs.
 */
export function BindingHeader({
  bindingId,
  binding,
  active,
  actions,
}: {
  bindingId: string;
  binding: ToolBindingDetail | undefined;
  active: BindingTabId;
  actions?: React.ReactNode;
}) {
  const names = useProviderToolNames();
  const title = binding ? names.bindingLabel(binding) : null;

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex w-full flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-[16rem] flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {title ? (
              <h1 className="min-w-0 break-words text-heading-sm text-01 tablet:text-heading-md">{title}</h1>
            ) : (
              <Skeleton className="h-7 w-48" />
            )}
            {binding ? (
              <StatusChip
                status={bindingStatusChip(binding.status)}
                detail={binding.status === "ACTIVE" && binding.hasUnpublishedChanges ? "unpublished changes" : undefined}
              />
            ) : null}
          </div>
          {binding ? (
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-03">
              <span className="min-w-0 break-all font-mono">{labelForEndpoint(binding.endpoint)}</span>
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <SectionTabs tabs={bindingScreens(bindingId)} activeId={active} label="Listing pages" />
    </div>
  );
}
