"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Code2, Filter as FilterIcon, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { BindingNav } from "@/features/provider-binding/binding-nav";
import { useParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { count, DASH, stampUtc } from "@/features/g34a/stats";
import {
  badgeForVerdict,
  countedText,
  failingRulesText,
  retentionHoursRemaining,
  retentionLabel,
  scoreText,
} from "@/features/provider-verdicts/format";
import {
  DEFAULT_VERDICT_SEGMENT,
  verdictEmptyState,
  type VerdictSegmentValue,
} from "@/features/provider-verdicts/empty-state";
import {
  fromDayToIso,
  toDayToIso,
  validateVerdictFilters,
} from "@/features/provider-verdicts/filters";
import type { ProviderVerdictListItem, VerdictStatus } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { getToolBinding, listSlaWindows, listProviderVerdicts } from "@/services";
import { labelForEndpoint, shortBindingId } from "@/utils/provider-label";
import { presentVerdict } from "@/utils/verdict";

/**
 * Verdict feed — route
 * `/provider/bindings/[bindingId]/verdicts`.
 *
 * ## There is no binding-scoped filter on the wire
 *
 * `GET /providers/me/verdicts` (`ListProviderVerdictsQueryDto`) has no
 * `bindingId` or `toolId` parameter — verified on the wire, both answer
 * `400 property … should not exist`. This route is nested under one binding,
 * so it needs the feed scoped to that binding's calls, and the API gives it
 * exactly one way to do that exactly: **`windowId`**. An SLA window belongs to
 * one binding, so `windowId=<this binding's current window>` scopes
 * the feed precisely. The feed opens on every verdict in that window, not on
 * failures only: a binding with only passed calls must not look empty
 * (BUG-R3-J-01).
 *
 * Toggling to "all time" has no such lever: the feed then reads the whole
 * provider's verdicts (every binding) and this screen filters the page to
 * `toolId === binding.toolId` client-side. That means a page can come back
 * with fewer than `limit` visible rows after filtering, and "Load more" may
 * need more than one click to surface the next matching row on a provider
 * with several active bindings. Accepted rather than hidden behind a
 * client-side re-page loop, which would turn one slow provider (many
 * bindings, thin per-binding traffic) into an unbounded fetch loop.
 *
 * ## The design's filter strip is not this screen's
 *
 * The frame draws a six-tab strip — "tool, provider, hour, status, verdict,
 * agent" — which is the Spend explorer's shared bench, copied in with the
 * frame (`AuditLogView`, `src/components/g31/audit-log-view.tsx`, documents
 * the same residue on a different screen). "Tool" and "provider" have no
 * meaning on a feed already scoped to one binding of this one provider, and
 * "status" (`PENDING`/`JUDGED`/`SETTLED`) is not a filter the query DTO
 * accepts. What this screen wires instead is exactly the doc's own list —
 * *"Filters by verdict, rule, agent, window and time"* — verdict and window
 * as the two tabs a provider reaches constantly, rule/agent/time behind the
 * Filter sheet.
 *
 * ## Two rows in the frame do not survive contact with the wire
 *
 * `bindingVersion` is always `null` (no column records it — see
 * `ProviderVerdictListItem`'s comment) and renders `DASH`, never omitted.
 * Retention is drawn as a hard countdown ("available 34h", "available 33h",
 * decrementing by exactly 1h per row) that no field on the wire can
 * reproduce — `retentionState` is `'RAW' | 'DIGESTED' | null`, with no hours
 * count. `retentionLabel()` derives a real countdown from `createdAt` and the
 * documented 72h policy instead; see that function's comment.
 *
 * ## Overlapping text in the export
 *
 * Several rows in the design show two lines of text drawn on top of each other
 * (e.g. "0.52" over "semantic relevance 0.44", "hashes only" over "available
 * 27h"). This is a design-export artefact, not an instruction to
 * overlap two states — this screen renders one row per verdict, one line per
 * cell, and does not attempt to reproduce whichever second layer that was.
 */

const REFRESH_MS = 60_000;

const VERDICT_SEGMENTS: {
  value: VerdictSegmentValue;
  label: string;
  statuses: VerdictStatus[] | undefined;
}[] = [
  { value: "failed", label: "failed", statuses: ["FAIL", "MISAPPLIED"] },
  { value: "passed", label: "passed", statuses: ["PASS", "EMPTY_CONFIRMED"] },
  { value: "degraded", label: "degraded", statuses: ["DEGRADED"] },
  { value: "all", label: "all", statuses: undefined },
];

interface AppliedFilters {
  agentId: string;
  reasonCode: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AppliedFilters = { agentId: "", reasonCode: "", from: "", to: "" };

function activeFilterCount(f: AppliedFilters): number {
  return Object.values(f).filter((v) => v !== "").length;
}

interface VerdictRow extends TableRowData {
  item: ProviderVerdictListItem;
}

/** Local text match over what is already on screen — the API's own `search` is inert on this route. */
function matchesSearch(item: ProviderVerdictListItem, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle === "") return true;
  return (
    (item.callId ?? "").toLowerCase().includes(needle) ||
    (item.agentId ?? "").toLowerCase().includes(needle) ||
    (item.reasonCode ?? "").toLowerCase().includes(needle) ||
    item.failingRules.some((rule) => rule.toLowerCase().includes(needle))
  );
}

export default function ProviderVerdictFeedPage() {
  const params = useParams<{ bindingId: string }>();
  const bindingId = params.bindingId;

  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    retry: 0,
  });
  const binding = bindingQuery.data;

  const windowsQuery = useQuery({
    queryKey: ["provider", "sla-windows", "verdict-feed", bindingId],
    queryFn: () => listSlaWindows({ bindingId, limit: 5 }),
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const windowItems = windowsQuery.data?.items ?? [];
  const currentWindow = windowItems.find((w) => w.status === "OPEN") ?? windowItems[0] ?? null;

  const [segment, setSegment] = React.useState<VerdictSegmentValue>(DEFAULT_VERDICT_SEGMENT);
  const [scope, setScope] = React.useState<"current" | "all">("current");
  const [search, setSearch] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  const [filterOpen, setFilterOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<AppliedFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = React.useState<AppliedFilters>(EMPTY_FILTERS);
  const [filterError, setFilterError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // "Current window" only means something once a window has ever opened.
  const effectiveScope: "current" | "all" =
    scope === "current" && currentWindow ? "current" : "all";

  const segmentDef = VERDICT_SEGMENTS.find((s) => s.value === segment) ?? VERDICT_SEGMENTS[0];
  const windowId = effectiveScope === "current" ? (currentWindow?.windowId ?? undefined) : undefined;

  const verdictsQuery = useInfiniteQuery({
    queryKey: [
      "provider",
      "verdicts",
      bindingId,
      segment,
      effectiveScope,
      currentWindow?.windowId,
      applied,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listProviderVerdicts({
        limit: 25,
        cursor: pageParam,
        verdictStatus: segmentDef.statuses,
        windowId,
        agentId: applied.agentId || undefined,
        reasonCode: applied.reasonCode || undefined,
        from: fromDayToIso(applied.from),
        to: toDayToIso(applied.to),
      }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    enabled: windowsQuery.isFetched,
    retry: 0,
  });

  const rawItems = React.useMemo(
    () => (verdictsQuery.data?.pages ?? []).flatMap((page) => page.items),
    [verdictsQuery.data]
  );

  const scopedItems = React.useMemo(() => {
    if (effectiveScope === "current") return rawItems;
    if (!binding) return rawItems;
    return rawItems.filter((item) => item.toolId === binding.toolId);
  }, [rawItems, effectiveScope, binding]);

  const visible = React.useMemo(
    () => scopedItems.filter((item) => matchesSearch(item, search)),
    [scopedItems, search]
  );

  const rows: VerdictRow[] = visible.map((item) => ({ id: item.id, item }));

  const bodiesChip = React.useMemo(() => {
    if (nowMs === null) return null;
    const hours = scopedItems
      .map((item) =>
        retentionHoursRemaining(item.retentionState, item.createdAt, nowMs, item.bodiesExpireAt)
      )
      .filter((h): h is number => h !== null);
    if (hours.length === 0) return null;
    return Math.floor(Math.min(...hours));
  }, [scopedItems, nowMs]);

  const columns: TableColumn<VerdictRow>[] = [
    {
      key: "time",
      header: "Time",
      cell: (r) => stampUtc(r.item.createdAt),
      width: 140,
      mono: true,
    },
    {
      key: "callId",
      header: "Call id",
      cell: (r) =>
        r.item.callId ? (
          <Link
            href={`/provider/bindings/${bindingId}/verdicts/${r.item.id}`}
            className="text-primary-600 hover:underline"
          >
            {shortBindingId(r.item.callId)}
          </Link>
        ) : (
          <Link
            href={`/provider/bindings/${bindingId}/verdicts/${r.item.id}`}
            className="text-primary-600 hover:underline"
          >
            {DASH}
          </Link>
        ),
      width: 110,
      mono: true,
    },
    {
      key: "class",
      header: "Class",
      cell: (r) => r.item.callClass ?? DASH,
      width: 90,
      mono: true,
    },
    {
      key: "verdict",
      header: "Verdict",
      cell: (r) => {
        const presented = presentVerdict(r.item.verdictStatus ?? undefined);
        return <Badge variant={badgeForVerdict(r.item)} title={presented.shownAs} />;
      },
      width: 110,
    },
    {
      key: "score",
      header: "Score",
      cell: (r) => scoreText(r.item.score),
      width: 70,
      mono: true,
    },
    {
      key: "failingRules",
      header: "Failing rules",
      cell: (r) => (
        <span title={failingRulesText(r.item.failingRules)}>
          {failingRulesText(r.item.failingRules)}
        </span>
      ),
    },
    {
      key: "agent",
      header: "Agent",
      cell: (r) => (r.item.agentId ? shortBindingId(r.item.agentId) : DASH),
      width: 90,
      mono: true,
    },
    {
      key: "policyVersion",
      header: "Policy v",
      cell: (r) => count(r.item.decisionPolicyVersion),
      width: 80,
      mono: true,
      align: "end",
    },
    {
      key: "bindingVersion",
      header: "Binding v",
      cell: () => DASH,
      width: 90,
      mono: true,
      align: "end",
    },
    {
      key: "counted",
      header: "Counted",
      cell: (r) => countedText(r.item.countedTowardWindow),
      width: 80,
      mono: true,
      align: "end",
    },
    {
      key: "bodies",
      header: "Bodies",
      cell: (r) =>
        nowMs === null
          ? DASH
          : retentionLabel(r.item.retentionState, r.item.createdAt, nowMs, r.item.bodiesExpireAt),
      width: 130,
      mono: true,
      align: "end",
    },
  ];

  const bindingLabel = binding ? labelForEndpoint(binding.endpoint) : shortBindingId(bindingId);

  const apiSnippet = React.useMemo(() => {
    const q = new URLSearchParams();
    q.set("limit", "25");
    if (segmentDef.statuses) segmentDef.statuses.forEach((s) => q.append("verdictStatus", s));
    if (windowId) q.set("windowId", windowId);
    if (applied.agentId) q.set("agentId", applied.agentId);
    if (applied.reasonCode) q.set("reasonCode", applied.reasonCode);
    if (applied.from) q.set("from", fromDayToIso(applied.from) as string);
    if (applied.to) q.set("to", toDayToIso(applied.to) as string);
    return `GET /providers/me/verdicts?${q.toString()}\nAuthorization: Bearer <your token>`;
  }, [segmentDef, windowId, applied]);

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-heading-lg text-01">
            Verdicts · {bindingLabel}
          </h1>
          <p className="text-body-13 text-02">
            every judged call in the current window · also available as an API stream so you can
            mirror it into your own observability
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" icon={<Code2 aria-hidden="true" />}>
                API
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[560px]">
              <DialogHeader>
                <DialogTitle>This feed as an API stream</DialogTitle>
              </DialogHeader>
              <p className="text-body-13 text-02">
                The exact request this screen is making, with your current filters applied. Point
                your own observability at this route rather than scraping the console.
              </p>
              <CodeBlock title="curl" code={apiSnippet} />
            </DialogContent>
          </Dialog>

          <Button
            variant="secondary"
            icon={<FilterIcon aria-hidden="true" />}
            onClick={() => {
              setDraft(applied);
              setFilterError(null);
              setFilterOpen(true);
            }}
          >
            Filter{activeFilterCount(applied) > 0 ? ` (${activeFilterCount(applied)})` : ""}
          </Button>
        </div>
      </header>

      <BindingNav bindingId={bindingId} />

      {/* ── Filter row ─────────────────────────────────────────────────── */}
      <div className="flex w-full flex-wrap items-center gap-2.5">
        <Segmented
          value={segment}
          onValueChange={(v) => setSegment(v as VerdictSegmentValue)}
          aria-label="Verdict filter"
        >
          {VERDICT_SEGMENTS.map((s) => (
            <SegmentedItem key={s.value} value={s.value}>
              {s.label}
            </SegmentedItem>
          ))}
        </Segmented>

        <Segmented
          value={scope}
          onValueChange={(v) => setScope(v as "current" | "all")}
          aria-label="Window scope"
        >
          <SegmentedItem value="current" disabled={!currentWindow}>
            {currentWindow ? `window ${currentWindow.label}` : "no window yet"}
          </SegmentedItem>
          <SegmentedItem value="all">all time</SegmentedItem>
        </Segmented>

        <Search
          ref={searchRef}
          wrapperClassName="w-[260px]"
          placeholder="call id, agent or rule…"
          aria-label="Search verdicts"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {bodiesChip !== null ? (
          <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-03 px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px] text-02">
            BODIES AVAILABLE FOR {bodiesChip}H
          </span>
        ) : null}
      </div>

      {/* ── Feed ───────────────────────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>
              {visible.length > 0
                ? `${count(visible.length)} verdicts${
                    effectiveScope === "current" && currentWindow ? ` in ${currentWindow.label}` : ""
                  }`
                : "Verdicts"}
            </PanelTitle>
            <PanelDescription>the same rows the evidence pack shows</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {verdictsQuery.isError ? (
            <p className="p-3 text-body-13 text-danger-600">
              {verdictsQuery.error instanceof ApiError && verdictsQuery.error.status === 400
                ? verdictsQuery.error.message
                : "This feed could not be loaded. It may belong to another organisation, or the binding id may not exist."}
            </p>
          ) : verdictsQuery.isPending || windowsQuery.isPending || bindingQuery.isPending ? (
            <p className="p-3 font-mono text-mono-13 text-03">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="p-3">
              <EmptyState
                icon={<ShieldCheck aria-hidden="true" width={22} height={22} />}
                {...verdictEmptyState({
                  segment,
                  windowLabel:
                    effectiveScope === "current" && currentWindow ? currentWindow.label : null,
                  windowVerifiedCalls: currentWindow?.verifiedCalls,
                  filtersApplied: activeFilterCount(applied) > 0,
                  searching: scopedItems.length > 0,
                })}
              />
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <Table caption="Verdicts on this binding" columns={columns} rows={rows} className="min-w-[1040px]" />
            </div>
          )}
        </PanelBody>
      </Panel>

      {verdictsQuery.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={verdictsQuery.isFetchingNextPage}
          onClick={() => verdictsQuery.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}

      {/* ── Filter sheet ─────────────────────────────────────────────────── */}
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filter verdicts</SheetTitle>
          </SheetHeader>
          <div className="flex w-full flex-col gap-3.5 px-[18px] py-3">
            <Field
              label="Agent id"
              placeholder="uuid"
              value={draft.agentId}
              onChange={(e) => setDraft((d) => ({ ...d, agentId: e.target.value }))}
              hint="Exact match on the agent that made the call."
            />
            <Field
              label="Rule (reason code)"
              placeholder="stale_timestamp"
              value={draft.reasonCode}
              onChange={(e) => setDraft((d) => ({ ...d, reasonCode: e.target.value }))}
              hint="Exact match on the decisive reason code — not a search."
            />
            <div className="flex w-full gap-3">
              <Field
                label="From (UTC)"
                type="date"
                value={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              />
              <Field
                label="To (UTC)"
                type="date"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </div>
            {filterError ? (
              <p role="alert" className="text-body-13 text-danger-600">
                {filterError}
              </p>
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end gap-2.5">
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
                setFilterError(null);
                setFilterOpen(false);
              }}
            >
              Clear
            </Button>
            <Button
              onClick={() => {
                const problem = validateVerdictFilters(draft);
                if (problem) {
                  setFilterError(problem);
                  return;
                }
                setFilterError(null);
                setApplied({ ...draft, agentId: draft.agentId.trim() });
                setFilterOpen(false);
              }}
            >
              Apply
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
