"use client";

import { useQuery } from "@tanstack/react-query";
import { FileCog } from "lucide-react";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { PolicyChangeCard } from "@/features/provider-policy-changes/policy-change-card";
import type { PolicyChange } from "@/interfaces/provider-policy-changes";
import { listPolicyChanges } from "@/services/provider-policy-changes.service";

/**
 * Policy change centre — route
 * `/provider/policy-changes`.
 *
 * MVP notice slice only (the rest of the screen is planned for a later
 * phase). This renders exactly three things per
 * pending version: the effective date (always absent, and said so), the
 * structural diff against the version in force, and which of this provider's
 * own bindings it touches. It deliberately does NOT draw the design frame's
 * "Run golden set against v4" action, "Auto-pause on version change" toggle,
 * the own-traffic divergence banner ("14 of your last 1,000 verified calls
 * change verdict"), or the "Object to this version" form — `GET
 * /providers/me/policy-changes` has no field backing any of the four, and
 * all four are planned for a later phase.
 *
 * ## The nav badge
 *
 * `src/components/layout/sidebar.tsx`'s "Policy changes" row already accepts
 * a `policyChangesCount` prop; `(console)/layout.tsx` never passes one, so it
 * silently renders 0 and the badge never shows. There is no
 * `policy-changes/unread-count`-shaped endpoint the way Inbox has one. If a
 * badge is wanted, the only honest source available today is this same
 * array's length (`GET /providers/me/policy-changes`, one row per tool with a
 * pending version) — not wired here, since `layout.tsx` is not
 * owned by this screen.
 *
 * ## The tool label
 *
 * The DTO carries only `toolId` (a bare uuid), so the label is the tool's
 * name from the provider catalogue (`useProviderToolNames`), else "One of
 * your tools". Never the endpoint's host: a listing is never named by its
 * address.
 */

function toolLabelFor(change: PolicyChange, toolName: (toolId: string) => string | null): string {
  // Never the endpoint: a host or an IP is infrastructure, not a tool's name.
  return toolName(change.toolId) ?? "One of your tools";
}

export default function PolicyChangesPage() {
  const changesQuery = useQuery({
    queryKey: ["provider", "policy-changes"],
    queryFn: () => listPolicyChanges(),
    retry: 0,
  });

  const names = useProviderToolNames();
  const changes: PolicyChange[] = changesQuery.data ?? [];

  const subtitle =
    changes.length === 0
      ? "Nothing pending affects your tools right now"
      : `${changes.length} upcoming change${changes.length === 1 ? "" : "s"} to how results of your tools are checked, and what each means for you`;

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-sm text-01 tablet:text-heading-md">Policy changes</h1>
        <p className="text-body-13 text-03">{subtitle}</p>
      </header>

      {changesQuery.isPending ? (
        <PageState kind="loading" rows={3} label="Loading policy changes" />
      ) : changesQuery.isError ? (
        <PageState kind="error" description="Policy changes could not be loaded." onRetry={() => void changesQuery.refetch()} />
      ) : changes.length === 0 ? (
        <PageState
          kind="empty"
          icon={<FileCog width={22} height={22} aria-hidden="true" />}
          title="No pending changes"
          description="When Assay changes the checks on a tool you list, the change shows here, with what differs and the tools it touches, before it takes effect."
        />
      ) : (
        <div className="flex w-full flex-col gap-4">
          {changes.map((change) => (
            <PolicyChangeCard
              key={change.toolId}
              change={change}
              toolLabel={toolLabelFor(change, names.toolName)}
            />
          ))}
        </div>
      )}
    </>
  );
}
