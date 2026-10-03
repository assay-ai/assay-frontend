"use client";

import { useQuery } from "@tanstack/react-query";
import { FileCog } from "lucide-react";
import * as React from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PolicyChangeCard } from "@/features/provider-policy-changes/policy-change-card";
import type { ToolBindingSummary } from "@/interfaces";
import type { PolicyChange } from "@/interfaces/provider-policy-changes";
import { listToolBindings } from "@/services";
import { listPolicyChanges } from "@/services/provider-policy-changes.service";
import { labelForEndpoint, shortBindingId } from "@/utils/provider-label";

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
 * The DTO carries only `toolId` (a bare uuid) — no tool name, matching every
 * other provider screen's own gap (`labelForEndpoint` in
 * `@/utils/provider-label`). This screen resolves a human label the same way
 * the console rail does: join `change.bindings[0].bindingId` against `GET
 * /providers/me/tool-bindings` for that binding's `endpoint`, then take its
 * host. A tool this provider is bound to always has at least one binding row
 * (that is how it appears in this endpoint's join at all), so the fallback
 * only fires if the two reads race or disagree.
 */

function toolLabelFor(change: PolicyChange, endpointByBindingId: Map<string, string>): string {
  for (const binding of change.bindings) {
    const endpoint = endpointByBindingId.get(binding.bindingId);
    if (endpoint) return labelForEndpoint(endpoint);
  }
  return `tool ${shortBindingId(change.toolId)}`;
}

export default function PolicyChangesPage() {
  const changesQuery = useQuery({
    queryKey: ["provider", "policy-changes"],
    queryFn: () => listPolicyChanges(),
    retry: 0,
  });

  // Shell data already fetches this for the sidebar rail; this screen fetches
  // its own copy rather than reaching into `(console)/layout.tsx`'s query,
  // which is private to that file. React Query dedupes by key regardless.
  const bindingsQuery = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });

  const changes: PolicyChange[] = changesQuery.data ?? [];
  const bindings: ToolBindingSummary[] = bindingsQuery.data?.items ?? [];
  const endpointByBindingId = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const binding of bindings) map.set(binding.id, binding.endpoint);
    return map;
  }, [bindings]);

  const subtitle =
    changes.length === 0
      ? "No pending version affects your bindings right now"
      : `${changes.length} pending version${changes.length === 1 ? "" : "s"} affecting your bindings`;

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Policy changes</h1>
        <p className="font-mono text-mono-12 text-03">{subtitle}</p>
      </header>

      {changesQuery.isPending ? (
        <p className="text-body-13 text-03">Loading policy changes…</p>
      ) : changesQuery.isError ? (
        <p className="text-body-13 text-03">
          Policy changes could not be loaded. Reload the page to try again.
        </p>
      ) : changes.length === 0 ? (
        <EmptyState
          icon={<FileCog width={22} height={22} aria-hidden="true" />}
          title="No pending policy changes"
          description="None of your bindings have a SHADOW verification policy pending right now. When an engineer proposes a new version for a tool you're bound to, it appears here with the structural diff against the version currently in force and every one of your bindings it would touch — you will see it before it takes effect, not after."
          className="max-w-[560px]"
        />
      ) : (
        <div className="flex w-full flex-col gap-4">
          {changes.map((change) => (
            <PolicyChangeCard
              key={change.toolId}
              change={change}
              toolLabel={toolLabelFor(change, endpointByBindingId)}
            />
          ))}
        </div>
      )}
    </>
  );
}
