"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import {
  looksLikeUuid,
  otherAgentsRow,
  refundedRate,
  splitByStatus,
  type StatusSplit,
} from "@/features/provider-traffic/breakdown";
import { AgentIdCell } from "@/features/provider-traffic/agent-id-cell";
import { DASH, count, percent } from "@/features/g34a/stats";
import type { ProviderAgentTraffic } from "@/interfaces";
import { getProviderTraffic } from "@/services";

/**
 * Per-agent traffic — route
 * `/provider/agent-traffic`.
 *
 * ## Why this is a new `(console)` route rather than the existing `(minimal)`
 * `/provider/traffic` — and why not literally `/provider/traffic`
 *
 * They are different screens answering different questions, and the frame
 * settles which shell this one uses: the design draws the full 248px provider
 * console sidebar (Home / Inbox / Bindings / Capital / Money / Policy
 * changes / Account) — the `(console)` layout's chrome. `(minimal)`'s
 * `/provider/traffic` is the **sidebar-less** 56px-bar shell (see
 * `(minimal)/layout.tsx`'s own screen table) and is scoped to one binding's
 * mapping and pause control, deliberately reading `calls/export` instead of
 * `GET /providers/me/traffic` because — per that file's own docstring —
 * traffic has "no tool or binding dimension". `GET /providers/me/traffic`
 * still has none: `GetProviderTrafficQueryDto` (backend) takes `from`, `to`
 * and `agentId` only, never a `bindingId`. So a per-binding "per-agent
 * traffic" is not buildable from this endpoint at all, and extending that screen
 * would have meant grafting provider-wide numbers onto a screen whose whole
 * point is one binding. Kept separate on purpose — see "Provider-wide, not
 * per-binding" below for what that costs the design.
 *
 * The route is `/provider/agent-traffic`, not the frame's implied
 * `/provider/traffic`: Next.js resolves route groups into one path space, so
 * `(console)/provider/traffic` and `(minimal)/provider/traffic` (already
 * there) would both claim `/provider/traffic` and the build fails
 * outright — "You cannot have two parallel pages that resolve to the same
 * path". Not a style choice; the literal path was unavailable.
 *
 * ## Provider-wide, not per-binding
 *
 * The frame's H1 reads "Per-agent traffic · bnd_7K2" and its sidebar
 * highlights one binding (`search_web`) as though the table below were that
 * binding's traffic. It is not, and cannot be: `agentBreakdown` groups
 * `payment_intents` by `agent_id` and `provider_id` alone. This screen's
 * title drops the binding suffix and its copy says "every binding" rather
 * than implying one — a design/backend divergence, handled openly rather than
 * by silently building a binding-scoped screen that would just show the same
 * numbers regardless of which binding the URL named.
 *
 * There is also no navigation entry point to this route: the Sidebar
 * component's row set (`home / inbox / bindings / capital / money /
 * policy-changes / account`) is fixed and has no "Traffic" row. Adding one is
 * a change to `sidebar.tsx`, not to this file.
 *
 * ## What the design wanted, and what actually shipped
 *
 * The frame draws `Failures` / `Fail rate` / `Excluded` / `Net to you`
 * columns. Only a pseudonymous per-agent breakdown on paid traffic is
 * rendered; a free-tier per-agent view is not. Concretely:
 *
 * - **`Failures` / `Fail rate` → `Refunded` / `Refunded rate`.** The wire has
 *   no verdict on this endpoint, only `PaymentIntentStatus`. In the
 *   payment-intent lifecycle, `REFUNDED` is the one status that is both a real failure (verification failed, the
 *   agent was made whole) and provider-attributable (it is the only status
 *   that counts toward an SLA window). Naming it "Refunded" rather than
 *   "Failures" also keeps it from colliding with `verdict` (PASS/FAIL), a
 *   different field the binding-traffic screen's "quality" figure reads off a different
 *   endpoint — two screens both saying "fail rate" over different
 *   definitions would be worse than one screen using its status's real name.
 *   See `src/features/provider-traffic/breakdown.ts` for the full reasoning.
 * - **`Excluded` — omitted, not dashed.** Columns for per-agent
 *   failures-excluded and earnings are not rendered because no endpoint
 *   returns them. A `DASH` column would say "tracked, not known here", so
 *   there is no column — explained in the banner below instead.
 * - **`Net to you` (per-agent money) — omitted.** No endpoint groups earned
 *   money by `agentId`; `earnings` groups by day or by tool only.
 *
 * ## `p50LatencyMs` / `p95LatencyMs`
 *
 * Always `null` — `payment_intents` has no latency column. Rendered as fixed
 * `DASH` tiles with a label saying the measurement does not exist, rather
 * than computed from `buckets` (which would still be null) or hidden.
 *
 * ## "N other agents"
 *
 * `agentBreakdown` is server-truncated to the top 10 callers by volume, and
 * says so (`GetProviderTrafficResponseDto.agentBreakdown`'s own doc). Rather
 * than let a 10-row table read as the whole answer, `otherAgentsRow` derives
 * an aggregate row for everyone else from two real, exhaustive totals already
 * in the same response (`totalCalls` and the day/status `buckets`) — a
 * subtraction, not an estimate. It cannot say how many distinct agents that
 * is (the wire does not say), so it is labelled "other agents", not the
 * design's invented count ("87 others").
 *
 * ## The `agentId` filter
 *
 * The one filter this endpoint added for this screen. Read as an initial value
 * from `?agentId=` for deep-linking (same pattern the `(minimal)` traffic
 * page uses for `?bindingId=`), editable via a text input rather than a
 * picker — there is no agent directory to pick from, only an opaque id a
 * provider would paste in from somewhere else (an evidence pack, a support
 * ticket). Validated client-side against the same shape the server's
 * `@IsUUID()` enforces, so a typo reads as "not a valid agent id" rather than
 * a round trip to a 400.
 */

const WINDOW_DAYS = 30;

function last30Days(nowMs: number): { from: string; to: string } {
  return {
    from: new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString(),
    to: new Date(nowMs).toISOString(),
  };
}

interface AgentRow extends TableRowData {
  isOther: boolean;
  agentId: string | null;
  calls: number;
  split: StatusSplit;
}

function ProviderTrafficPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const deepLinkedAgentId = (searchParams.get("agentId") ?? "").trim();
  // A deep link is validated like Apply is: a bad id is shown inline and never sent.
  const deepLinkValid = deepLinkedAgentId === "" || looksLikeUuid(deepLinkedAgentId);

  const [agentInput, setAgentInput] = React.useState(deepLinkedAgentId);
  const [appliedAgentId, setAppliedAgentId] = React.useState(deepLinkValid ? deepLinkedAgentId : "");
  const [validationError, setValidationError] = React.useState(!deepLinkValid);

  // Keep `?agentId=` in step with the applied filter so a reload re-applies what is on screen.
  const syncUrl = (agentId: string) => {
    router.replace(agentId ? `${pathname}?agentId=${encodeURIComponent(agentId)}` : pathname, {
      scroll: false,
    });
  };

  // Fixed once per mount rather than recomputed every render, so the query
  // key (and the window shown in the panel description) does not drift
  // while the page is open.
  const range = React.useMemo(() => last30Days(Date.now()), []);

  const trafficQuery = useQuery({
    queryKey: ["provider", "traffic", range.from, range.to, appliedAgentId || null],
    queryFn: () =>
      getProviderTraffic({
        from: range.from,
        to: range.to,
        agentId: appliedAgentId || undefined,
      }),
    retry: 0,
  });

  const applyFilter = () => {
    const trimmed = agentInput.trim();
    if (trimmed !== "" && !looksLikeUuid(trimmed)) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    setAppliedAgentId(trimmed);
    syncUrl(trimmed);
  };

  const clearFilter = () => {
    setAgentInput("");
    setAppliedAgentId("");
    setValidationError(false);
    syncUrl("");
  };

  const traffic = trafficQuery.data;

  const rows: AgentRow[] = React.useMemo(() => {
    if (!traffic) return [];
    const agentRows: AgentRow[] = traffic.agentBreakdown.map((agent: ProviderAgentTraffic) => ({
      id: agent.agentId,
      isOther: false,
      agentId: agent.agentId,
      calls: agent.calls,
      split: splitByStatus(agent.byStatus),
    }));

    const other = otherAgentsRow(traffic);
    if (other) {
      agentRows.push({
        id: "other-agents",
        isOther: true,
        agentId: null,
        calls: other.calls,
        split: other.split,
      });
    }
    return agentRows;
  }, [traffic]);

  const columns: TableColumn<AgentRow>[] = [
    {
      key: "agent",
      header: "Agent",
      mono: true,
      cell: (row) =>
        row.isOther ? (
          <span className="text-02">other agents</span>
        ) : (
          <AgentIdCell agentId={row.agentId as string} />
        ),
    },
    { key: "calls", header: "Calls", width: 100, align: "end", mono: true, cell: (r) => count(r.calls) },
    {
      key: "settled",
      header: "Settled",
      width: 100,
      align: "end",
      mono: true,
      cell: (r) => count(r.split.settled),
    },
    {
      key: "refunded",
      header: "Refunded",
      width: 100,
      align: "end",
      mono: true,
      cell: (r) => count(r.split.refunded),
    },
    {
      key: "refundedRate",
      header: "Refunded rate",
      width: 130,
      align: "end",
      mono: true,
      cell: (r) => percent(refundedRate(r.split), 1),
    },
    {
      key: "other",
      header: "Other",
      width: 90,
      align: "end",
      mono: true,
      cell: (r) => count(r.split.other),
    },
  ];

  const totalRow = React.useMemo(() => {
    if (rows.length === 0) return undefined;
    const totals = rows.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        settled: acc.settled + row.split.settled,
        refunded: acc.refunded + row.split.refunded,
        other: acc.other + row.split.other,
      }),
      { calls: 0, settled: 0, refunded: 0, other: 0 }
    );
    return {
      label: "Total (window)",
      values: {
        calls: count(totals.calls),
        settled: count(totals.settled),
        refunded: count(totals.refunded),
        refundedRate: percent(totals.calls > 0 ? totals.refunded / totals.calls : null, 1),
        other: count(totals.other),
      },
    };
  }, [rows]);

  return (
    <>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <h1 className="truncate text-heading-lg text-01">Per-agent traffic</h1>
          <p className="text-body-sm leading-[1.55] text-02">
            Pseudonymous, stable agent identifiers: per-agent traffic on paid calls
          </p>
        </div>

        <Button
          variant="secondary"
          icon={<Download aria-hidden="true" />}
          disabled
          title="Exporting this per-agent view is not available yet. The per-call CSV export is on Reconciliation."
        >
          Export
        </Button>
      </header>

      {/* ── Filter ───────────────────────────────────────────────────────── */}
      <Panel>
        <PanelBody className="gap-2.5 p-4">
          <div className="flex w-full flex-col items-start gap-2.5 tablet:flex-row tablet:items-center">
            <label htmlFor="agent-id-filter" className="text-label-13 text-01">
              Agent id
            </label>
            <Input
              id="agent-id-filter"
              value={agentInput}
              onChange={(e) => {
                setAgentInput(e.target.value);
                setValidationError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilter();
              }}
              placeholder="paste a full agent id (uuid)"
              className="h-9 max-w-sm py-1.5 text-mono-13 font-mono"
            />
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="secondary" onClick={applyFilter}>
                Apply
              </Button>
              {appliedAgentId || validationError ? (
                <Button size="sm" variant="ghost" onClick={clearFilter}>
                  Clear
                </Button>
              ) : null}
            </div>
            <p className="font-mono text-mono-12 text-03 tablet:ml-auto">
              last {WINDOW_DAYS} days, every binding
            </p>
          </div>
          {validationError ? (
            <p role="alert" className="text-body-13 text-danger-600">
              That is not a valid agent id. An agent id is a UUID.
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      {/* ── Tiles ────────────────────────────────────────────────────────── */}
      <section className="grid w-full grid-cols-1 gap-3.5 mobile:grid-cols-3">
        <MetricTile
          label="Calls"
          value={count(traffic?.totalCalls ?? null)}
          sub={appliedAgentId ? "this agent, last 30 days" : "every agent, last 30 days"}
        />
        <MetricTile
          label="p50 latency"
          value={DASH}
          sub="not available yet"
        />
        <MetricTile
          label="p95 latency"
          value={DASH}
          sub="not available yet"
        />
      </section>

      {/* ── Agent breakdown ──────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader className="bg-02">
          <PanelTitles>
            <PanelTitle>Agents calling you</PanelTitle>
            <PanelDescription>top 10 by calls · every binding · last 30 days</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3.5 p-5">
          {trafficQuery.isError ? (
            <p className="text-body-13 text-03">
              Traffic could not be loaded. Reload the page to try again.
            </p>
          ) : trafficQuery.isLoading ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No traffic in this window"
              description={
                appliedAgentId
                  ? "This agent has not called any of your bindings in the last 30 days."
                  : "No agent has called your bindings in the last 30 days."
              }
            />
          ) : (
            <div className="w-full overflow-x-auto">
              <Table
                caption="Agents calling you"
                columns={columns}
                rows={rows}
                total={totalRow}
                className="min-w-[720px]"
              />
            </div>
          )}
        </PanelBody>
      </Panel>

      <Banner
        tone="primary"
        title="What this table can and cannot show"
        description={
          'Refunded is the closest signal to a failed call in this window. Per-agent earnings and a ' +
          "griefing flag are not shown."
        }
      />
    </>
  );
}

/**
 * `useSearchParams()` opts this route out of static prerendering; Next
 * requires a Suspense boundary around the component that reads it. Same
 * pattern as the `(minimal)` traffic page's own `bindingId` deep link.
 */
export default function ProviderTrafficPage() {
  return (
    <React.Suspense fallback={null}>
      <ProviderTrafficPageContent />
    </React.Suspense>
  );
}
