"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { ApiError } from "@/libs/ApiClient";
import { listAuditLog } from "@/services/account.service";

import { MicroLabel, PageHeader } from "./chrome";
import { timestamp } from "./format";

/**
 * Activity and audit log.
 *
 * The design's most important line is in the panel subtitle, and it is a
 * product rule rather than a caption: individual tool calls are deliberately
 * NOT here, because mixing fifteen thousand of them into an audit log
 * destroys the log. A tool call is a receipt; an audit event is somebody
 * changing what is allowed. This screen renders `GET /audit-log` and nothing
 * else, so that separation holds by construction.
 *
 * The design's filter strip carries six segments — "tool, provider, hour,
 * status, verdict, agent" — which are the Spend explorer's, copied in with the
 * design. The classes the design's own rows actually use are Policy, Approval,
 * Authority and Money, and those are what the filter offers.
 *
 * `AuditLogEntryDto.action` is dotted and past-tense (`credential.revoked`),
 * so class is derived from its prefix rather than fetched — there is no class
 * field on the wire.
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
};

function classOf(action: string): ClassName {
  const prefix = action.split(".")[0];
  return CLASS_BY_PREFIX[prefix] ?? "Other";
}

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "all" },
  { value: "Policy", label: "policy" },
  { value: "Approval", label: "approval" },
  { value: "Authority", label: "authority" },
  { value: "Money", label: "money" },
];

/** A short human line from `before`/`after`, without dumping raw JSON at people. */
function detailOf(entry: AuditEntry): string {
  if (entry.after && Object.keys(entry.after).length > 0) {
    const pairs = Object.entries(entry.after).slice(0, 3);
    return pairs
      .map(([key, value]) => {
        const from = entry.before?.[key];
        if (from !== undefined && from !== value) return `${key} ${String(from)} → ${String(value)}`;
        return `${key} ${String(value)}`;
      })
      .join(" · ");
  }
  if (entry.resourceType) return `${entry.resourceType} ${entry.resourceId ?? ""}`.trim();
  return "—";
}

export function AuditLogView() {
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");

  const log = useInfiniteQuery({
    queryKey: ["audit-log", query],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      // `search` is a documented query parameter on GET /audit-log but is
      // absent from the shared `ListQuery` type, which only covers the four
      // parameters every list endpoint takes.
      listAuditLog({ limit: 50, cursor: pageParam, search: query || undefined } as never) as Promise<{
        items: AuditEntry[];
        pageInfo: { nextCursor: string | null; hasMore: boolean };
      }>,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
  });

  const entries = React.useMemo(
    () => (log.data?.pages ?? []).flatMap((page) => page.items),
    [log.data]
  );

  const visible = React.useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => classOf(e.action) === filter)),
    [entries, filter]
  );

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Activity and audit log"
        subtitle="typed events, filterable by actor, type and window · individual tool calls are receipts, not audit events"
        actions={
          <Button variant="secondary" icon={<Download />} type="button" disabled>
            Export
          </Button>
        }
      />

      <div className="flex w-full flex-col gap-2.5 tablet:flex-row tablet:items-center">
        <Segmented value={filter} onValueChange={setFilter} aria-label="Filter by class">
          {FILTERS.map((option) => (
            <SegmentedItem key={option.value} value={option.value}>
              {option.label}
            </SegmentedItem>
          ))}
        </Segmented>
        <Search
          wrapperClassName="w-full tablet:w-[280px]"
          placeholder="Actor, object or id…"
          aria-label="Search the audit log"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Events</PanelTitle>
            <PanelDescription className="whitespace-normal">
              individual tool calls are not listed here — see Spend for those
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {log.isError ? (
            <p className="p-3 text-body-13 text-danger-600">
              The audit log could not be read:{" "}
              {log.error instanceof ApiError ? log.error.message : "the request failed"}. This is not an empty log.
            </p>
          ) : log.isPending ? (
            <p className="p-3 font-mono text-mono-13 text-03">Loading…</p>
          ) : visible.length === 0 ? (
            <div className="p-3">
              {/* Three different empties: the account's, the search's and the class filter's. */}
              {entries.length > 0 ? (
                <EmptyState
                  icon={null}
                  title={`No ${filter} events in the entries loaded so far`}
                  description={
                    log.hasNextPage
                      ? "Other classes have entries. Choose All to see them, or load more below."
                      : "Other classes have entries. Choose All to see them."
                  }
                />
              ) : query ? (
                <EmptyState
                  icon={null}
                  title="No audit event matches this search"
                  description="The search looks at the actor, the action and the object's type and id."
                />
              ) : (
                /*
                  BUG-R2-B4-01: no product write records an audit event yet, so
                  an empty log does NOT mean nothing changed. Say where the
                  changes that are recorded can be read.
                */
                <EmptyState
                  icon={null}
                  title="No audit events are recorded yet"
                  description="Changes to limits, credentials and alert channels are not shown in this log yet. Limit changes are listed with who made them under Change history on Limits; credentials and their revocations are listed under Agents."
                />
              )}
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="min-w-[900px]">
                <div className="flex items-center gap-3 border-b border-02 px-3 pb-2.5">
                  <div className="w-[180px]">
                    <MicroLabel>When</MicroLabel>
                  </div>
                  <div className="w-[120px] text-right">
                    <MicroLabel>Class</MicroLabel>
                  </div>
                  <div className="min-w-0 flex-1 text-right">
                    <MicroLabel>Event</MicroLabel>
                  </div>
                  <div className="w-[210px] text-right">
                    <MicroLabel>Actor</MicroLabel>
                  </div>
                  <div className="w-[340px] text-right">
                    <MicroLabel>Detail</MicroLabel>
                  </div>
                </div>
                {visible.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 border-b border-01 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="w-[180px] font-mono text-mono-12 font-semibold text-01">
                      {timestamp(entry.createdAt)}
                    </div>
                    <div className="w-[120px] text-right font-mono text-mono-12 text-02">
                      {classOf(entry.action)}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-right font-mono text-mono-12 text-02">
                      {entry.action}
                    </div>
                    <div className="w-[210px] truncate text-right font-mono text-mono-12 text-02">
                      {entry.actorId ?? entry.actorType}
                    </div>
                    <div className="w-[340px] truncate text-right font-mono text-mono-12 text-02">
                      {detailOf(entry)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      {log.hasNextPage ? (
        <Button
          variant="secondary"
          type="button"
          className="self-start"
          loading={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
