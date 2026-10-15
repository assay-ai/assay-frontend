"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bot, Building2, ShieldCheck, User } from "lucide-react";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { auditSentence, groupByDay } from "@/features/buyer/audit-sentence";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { formatClock } from "@/libs/local-time";
import { listAuditLog } from "@/services/account.service";
import { cn } from "@/utils";

import { PageHeader } from "./chrome";

/**
 * Account › Activity log (`/audit-log`): who changed what, as plain sentences
 * in day-grouped cards ("You changed daily cap from 40.00 to 75.00 · 14:02").
 * Calls are receipts, not audit events, and stay under Activity › Calls.
 *
 * No search box: `GET /audit-log` ignores `search` today (BUG-R2-B4-02).
 * Export is not offered until there is something to export to.
 */

interface AuditEntry {
  id: string;
  actorType: "user" | "agent" | "system" | "provider";
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

type ClassName = "Policy" | "Approval" | "Authority" | "Money" | "Other";

const CLASS_BY_PREFIX: Record<string, ClassName> = {
  policy: "Policy",
  limit: "Policy",
  spend_policy: "Policy",
  approval: "Approval",
  credential: "Authority",
  signer: "Authority",
  session: "Authority",
  agent: "Authority",
  deposit: "Money",
  withdrawal: "Money",
  compensation: "Money",
  payout: "Money",
  payment_intent: "Money",
  // Where alerts go and which are sent is part of how the account is governed.
  notification_channel: "Policy",
  notification_preference: "Policy",
};

export function classOf(action: string): ClassName {
  const prefix = action.split(".")[0];
  return CLASS_BY_PREFIX[prefix] ?? "Other";
}

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Policy", label: "Spending limits & alerts" },
  { value: "Authority", label: "Agents & keys" },
  { value: "Money", label: "Money" },
];

const ACTOR_ICON = { user: User, agent: Bot, system: ShieldCheck, provider: Building2 } as const;

export function AuditLogView() {
  const [filter, setFilter] = React.useState("all");
  const { user } = usePrivy();
  const me = user?.email?.address ?? null;
  const names = useEntityNames({ kinds: ["agent"] });

  const log = useInfiniteQuery({
    queryKey: ["audit-log"],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAuditLog({ limit: 50, cursor: pageParam }) as Promise<{
        items: AuditEntry[];
        pageInfo: { nextCursor: string | null; hasMore: boolean };
      }>,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
  });

  const entries = React.useMemo(() => (log.data?.pages ?? []).flatMap((page) => page.items), [log.data]);
  const visible = React.useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => classOf(e.action) === filter)),
    [entries, filter],
  );
  const days = React.useMemo(() => groupByDay(visible), [visible]);
  const agentName = React.useCallback((id: string) => names.lookup("agent", id), [names]);

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Activity log" />
      <p className="-mt-2 text-body-13 text-03">
        Who changed what on your account: spending limits, agent keys and alerts. Individual calls are under Activity › Calls.
      </p>

      <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-label-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              filter === option.value ? "border-primary-500 bg-primary-10 text-primary-700" : "border-02 bg-01 text-02 hover:text-01",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {log.isError ? (
        <PageState
          kind="error"
          title="The activity log could not be loaded"
          description="This is not an empty log. Try again in a moment."
          onRetry={() => void log.refetch()}
          code={log.error instanceof ApiError ? log.error.code : null}
          details={log.error.message}
        />
      ) : log.isPending ? (
        <PageState kind="loading" rows={6} label="Loading the activity log" />
      ) : visible.length === 0 ? (
        entries.length > 0 ? (
          <PageState
            kind="empty"
            title="Nothing of this kind yet"
            description={log.hasNextPage ? "Show everything, or load older entries below." : "Other kinds of changes are listed under All."}
            action={{ label: "Show everything", onClick: () => setFilter("all") }}
          />
        ) : (
          <PageState
            kind="empty"
            title="No changes yet"
            description="When you change spending limits, create or revoke an agent key, or change alerts, it shows here."
            action={{ label: "Set spending limits", href: "/limits" }}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((group) => (
            <section key={group.day} className="flex flex-col gap-2">
              <h2 className="text-label-13 text-03">{group.day}</h2>
              <ul className="flex flex-col overflow-hidden rounded-xl border border-01 bg-01">
                {group.entries.map((entry) => {
                  const sentence = auditSentence(entry, agentName, me);
                  const Icon = ACTOR_ICON[entry.actorType as keyof typeof ACTOR_ICON] ?? User;
                  return (
                    <li key={entry.id} className="flex items-start gap-3 border-b border-01 px-4 py-3 last:border-b-0 tablet:px-5">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-02 text-02">
                        <Icon aria-hidden="true" className="size-3.5" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-label-sm text-01">{sentence.title}</span>
                        <span className="break-words text-body-13 text-02">{sentence.line}</span>
                        {entry.resourceId ? (
                          <span className="pt-0.5">
                            <CopyChip value={entry.resourceId} label="reference" display="Copy reference" />
                          </span>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-body-xs text-03">{formatClock(entry.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {log.hasNextPage ? (
        <Button
          variant="secondary"
          type="button"
          className="self-start"
          loading={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          Show older
        </Button>
      ) : null}
    </div>
  );
}
