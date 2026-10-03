"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Pause, Play, Settings } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Meter } from "@/components/ui/meter";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import {
  Table,
  type TableColumn,
  type TableRowData,
} from "@/components/ui/table";
import { WindowGauge } from "@/components/ui/window-gauge";
import type {
  ProviderEarnings,
  SlaWindow,
  ToolBindingDetail,
} from "@/interfaces";
import {
  getProviderEarnings,
  getToolBinding,
  listSlaWindows,
  pauseToolBinding,
  resumeToolBinding,
} from "@/services";
import { formatMoney } from "@/utils/money";
import { labelForEndpoint } from "@/utils/provider-label";
import { wilson99 } from "@/features/g34a/stats";

/**
 * Binding overview.
 *
 * The design has exactly four children and this file renders exactly four:
 * **Page Header · Tiles · Row · Note**. There is deliberately no tab bar.
 * The product spec describes binding sub-tabs
 * (`Overview | SLA position | Verdicts | Windows | Configuration | Test`) and
 * no frame in the design implements them; the design wins. Binding identity
 * lives in the page header and navigation runs through the sidebar's binding
 * rows, which `(console)/layout.tsx` already renders.
 *
 * ## What is real and what is a dash
 *
 * Five figures this screen would like are `null` in the backend by
 * construction, not by accident — `paidQualityRate`, `freeQualityRate`,
 * `availabilityRate`, `p50LatencyMs` and `p95LatencyMs` are hard-coded `null`
 * in `ProviderQualityService` / `ProviderTrafficService`. They render as `—`,
 * the unknown glyph the design itself uses (the "Your value"
 * cell of the TOTAL row). Nothing here invents a number to fill a tile.
 *
 * The second, larger constraint is **scope**: `/traffic` and `/quality` are
 * provider-wide, with no binding or tool filter. The only per-tool figures the
 * API exposes are on `/earnings?groupBy=tool`, so every per-binding number on
 * this screen comes from there, keyed on the binding's `toolId`. Provider-wide
 * verdict counts are deliberately **not** shown on a binding tile: on the
 * paused `fx` binding, which has never taken a call, they would read as that
 * binding's own quality and be false.
 *
 * `/sla-windows` used to be provider-wide by the endpoint's own stated
 * contract; The backend now makes a window a real, per-**binding** row, so the
 * query below is now scoped with `?bindingId=` and the window panel names
 * this binding's own window, not a provider-wide stand-in.
 *
 * There is still no per-window live-position endpoint's worth of use here —
 * `GET /providers/me/bindings/{bindingId}/sla` (the SLA workbench screen's `getBindingSla`)
 * aggregates over every CLOSED window, which is a different question from
 * "the single latest window, open or closed" this panel answers — so this
 * screen keeps computing its own 99% interval with `wilson99` from the raw
 * counts, same as before. the SLA workbench screen and the live SLA position screen both moved to the server's
 * own interval where one exists for what they show; see `stats.ts`.
 */

/** The design's own unknown glyph, read off the design's TOTAL row. */
const DASH = "—";

/** `as of 12:41, refreshes every 60s` — the sub line is a promise, so keep it. */
const REFRESH_MS = 60_000;

// ── Time ───────────────────────────────────────────────────────────────────

/**
 * `Date.now()` in a render body makes every query key unstable and refetches
 * forever. This buckets the clock to the refresh interval, so the key changes
 * exactly once a minute — which is the behaviour the header line advertises —
 * and `setState` with an unchanged value is a no-op in between.
 */
function useMinuteTick(): number | null {
  const [ms, setMs] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setMs(Math.floor(Date.now() / REFRESH_MS) * REFRESH_MS);
    tick();
    const id = setInterval(tick, 5_000);
    return () => clearInterval(id);
  }, []);

  return ms;
}

interface Windows {
  now: string;
  h24: string;
  h48: string;
  dayStart: string;
}

function windowsFor(nowMs: number): Windows {
  const now = new Date(nowMs);
  return {
    now: now.toISOString(),
    h24: new Date(nowMs - 24 * 3_600_000).toISOString(),
    h48: new Date(nowMs - 48 * 3_600_000).toISOString(),
    dayStart: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString(),
  };
}

/** `12:41` — local time, matching the design's bare `HH:mm`. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `2026-08-10 09:01`, the format the design's panel sub line uses. */
function stamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

// ── Formatting ─────────────────────────────────────────────────────────────

function count(n: number | null | undefined): string {
  return n === null || n === undefined ? DASH : n.toLocaleString("en-US");
}

function percent(rate: number | null | undefined, digits = 2): string {
  return rate === null || rate === undefined
    ? DASH
    : `${(rate * 100).toFixed(digits)}%`;
}

/**
 * The design's `▲ 6% vs yesterday`. A change against zero has no percentage,
 * so it is the unknown glyph rather than an infinity or a fabricated 100%.
 */
function trend(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return DASH;
  if (previous === 0) return `${DASH} vs yesterday`;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct < 0 ? "▼" : "▲"} ${Math.abs(pct)}% vs yesterday`;
}

/**
 * The console's one human-readable name for a binding.
 *
 * **No API exposes a tool name** — `toolId` is a bare UUID and there is no
 * catalogue controller to join against — so the endpoint's host is the only
 * identifier on the wire a person can read. `(console)/layout.tsx` makes the
 * same substitution for the sidebar rows; the two must agree, so this is the
 * same function.
 */

// ── Data ───────────────────────────────────────────────────────────────────

/** The group for this binding's tool, or `null` when the window matched none. */
function toolGroup(
  data: ProviderEarnings | undefined,
  toolId: string | undefined,
) {
  if (!data || !toolId) return null;
  return data.groups.find((group) => group.key === toolId) ?? null;
}

/** `calls` for this tool, `0` once a response has arrived, `null` while it has not. */
function callsIn(
  data: ProviderEarnings | undefined,
  toolId: string | undefined,
): number | null {
  if (!data) return null;
  return toolGroup(data, toolId)?.calls ?? 0;
}

function useToolEarnings(from: string | undefined, to: string | undefined) {
  const usable = Boolean(from && to && from < to);

  return useQuery({
    queryKey: ["provider", "earnings", "tool", from, to],
    queryFn: () =>
      getProviderEarnings({
        from: from as string,
        to: to as string,
        groupBy: "tool",
      }),
    enabled: usable,
    // The window slides once a minute; without this every tile would blank
    // between the new key mounting and its response landing.
    placeholderData: (previous) => previous,
    retry: 0,
  });
}

// ── Screen ─────────────────────────────────────────────────────────────────

interface ScoreRow extends TableRowData {
  component: string;
  weight: string;
  value: string;
  contribution: string;
}

export default function BindingOverviewPage() {
  const params = useParams<{ bindingId: string }>();
  const bindingId = params.bindingId;
  const queryClient = useQueryClient();

  const nowMs = useMinuteTick();
  const windows = React.useMemo(
    () => (nowMs === null ? null : windowsFor(nowMs)),
    [nowMs],
  );

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const binding: ToolBindingDetail | undefined = bindingQuery.data;
  const toolId = binding?.toolId;

  const last24 = useToolEarnings(windows?.h24, windows?.now);
  const prev24 = useToolEarnings(windows?.h48, windows?.h24);
  const today = useToolEarnings(windows?.dayStart, windows?.now);

  const slaQuery = useQuery({
    queryKey: ["provider", "sla-windows", "latest", bindingId],
    queryFn: () => listSlaWindows({ bindingId, limit: 1 }),
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const slaWindow: SlaWindow | null = slaQuery.data?.items[0] ?? null;

  const [confirmingPause, setConfirmingPause] = React.useState(false);

  /*
    The write's own response body is the new binding, so it is written into the
    detail cache directly instead of invalidating and refetching it.

    That is not an optimisation. Provider `GET`s answer
    `Cache-Control: private, max-age=10, stale-while-revalidate=3600`, so a
    refetch fired straight after a write is served the **pre-write body from
    the browser's HTTP cache** — a 200, for up to an hour — and no amount of
    React Query invalidation reaches past that. Measured here: pause and resume
    both landed on the server while the header still read the old status until
    a hard reload. Seeding from the 201 body is the only thing on this side of
    the wire that shows a provider the state they just asked for. This does not fix the
    backend defect, it routes around it for the
    one query that would otherwise lie.
  */
  const applyWrite = (updated: ToolBindingDetail) => {
    queryClient.setQueryData(["provider", "tool-binding", bindingId], updated);
    void queryClient.invalidateQueries({
      queryKey: ["provider", "tool-bindings", "sidebar"],
    });
  };

  // Both answer 201, not 200 — nothing here branches on a status code, which
  // is the only way to stay right about that.
  const pause = useMutation({
    mutationFn: () => pauseToolBinding(bindingId),
    onSuccess: (updated) => {
      setConfirmingPause(false);
      applyWrite(updated);
    },
  });

  const resume = useMutation({
    mutationFn: () => resumeToolBinding(bindingId),
    onSuccess: applyWrite,
  });

  if (bindingQuery.isError) {
    return (
      <p className="text-body-13 text-03">
        This binding could not be loaded. It may belong to another organisation,
        or the id may not exist.
      </p>
    );
  }

  const isPaused = binding?.status === "PAUSED";
  const busy = pause.isPending || resume.isPending;

  const calls24 = callsIn(last24.data, toolId);
  const callsPrev = callsIn(prev24.data, toolId);
  const earnedToday = today.data
    ? (toolGroup(today.data, toolId)?.earned ?? null)
    : undefined;

  // ── Page Header ──────────────────────────────────────────────────────────

  const title = binding
    ? `${binding.id} · ${labelForEndpoint(binding.endpoint)}`
    : DASH;

  /*
    `ACTIVE · binding v3 · policy v3 · as of 12:41, refreshes every 60s`.

    Status and the binding revision are real. **There is no policy version on a
    binding** — `policyVersion` exists only per call, on a tester report and on
    an SLA evidence row — so that segment is the unknown glyph rather than a
    number lifted from somewhere it does not belong. `as of` is the last
    successful fetch, which is what makes the refresh claim checkable.
  */
  const subParts = [
    binding?.status ?? DASH,
    `binding v${binding?.version ?? DASH}`,
    `policy v${DASH}`,
    `as of ${bindingQuery.dataUpdatedAt ? clockTime(bindingQuery.dataUpdatedAt) : DASH}, refreshes every 60s`,
  ];

  // ── Row: the window in flight ────────────────────────────────────────────

  const windowIsOpen = slaWindow?.status === "OPEN";
  const ci =
    slaWindow && slaWindow.verifiedCalls > 0
      ? wilson99(slaWindow.failedCalls, slaWindow.verifiedCalls)
      : null;
  const declared = binding?.slaFailureRate ?? null;
  const overlaps =
    ci !== null && declared !== null && ci[0] <= declared && declared <= ci[1];

  const rateAmount =
    slaWindow === null
      ? DASH
      : `${percent(slaWindow.observedFailureRate)} vs declared ${percent(declared)}`;

  const rateNote =
    ci === null
      ? DASH
      : `99% CI ${percent(ci[0], 1)} – ${percent(ci[1], 1)}` +
        (overlaps
          ? " · the interval overlaps the threshold, which is why the minimum sample exists"
          : "");

  const ratePercent =
    slaWindow?.observedFailureRate != null && declared
      ? Math.min(100, (slaWindow.observedFailureRate / declared) * 100)
      : 0;

  const withinSla =
    slaWindow?.observedFailureRate != null && declared !== null
      ? slaWindow.observedFailureRate <= declared
      : true;

  // ── Row: routing share ───────────────────────────────────────────────────

  /*
    The five score components and their names are the design's. Their WEIGHTS
    and CONTRIBUTIONS are router configuration and no endpoint publishes them —
    hard-coding 0.40 / 0.15 / 0.20 / 0.15 / 0.10 here would be a copy of a
    backend constant that drifts silently the day it is retuned. Two of the
    five "Your value" cells are real; the rest are the unknown glyph.
  */
  const scoreRows: ScoreRow[] = [
    {
      id: "quality",
      component: "quality (30d)",
      weight: DASH,
      value: DASH,
      contribution: DASH,
    },
    {
      id: "sla",
      component: "declared SLA",
      weight: DASH,
      value: percent(declared, 1),
      contribution: DASH,
    },
    {
      id: "latency",
      component: "latency p95",
      weight: DASH,
      value: DASH,
      contribution: DASH,
    },
    {
      id: "price",
      component: "price",
      weight: DASH,
      value: binding ? formatMoney(binding.price, { decimals: 4 }) : DASH,
      contribution: DASH,
    },
    {
      id: "exploration",
      component: "exploration floor",
      weight: DASH,
      value: DASH,
      contribution: DASH,
    },
  ];

  const scoreColumns: TableColumn<ScoreRow>[] = [
    {
      key: "component",
      header: "Component",
      cell: (r) => r.component,
      mono: true,
    },
    {
      key: "weight",
      header: "Weight",
      cell: (r) => r.weight,
      width: 90,
      align: "end",
      mono: true,
    },
    {
      key: "value",
      header: "Your value",
      cell: (r) => r.value,
      width: 100,
      align: "end",
      mono: true,
    },
    {
      key: "contribution",
      header: "Contribution",
      cell: (r) => r.contribution,
      width: 110,
      align: "end",
      mono: true,
    },
  ];

  return (
    <>
      {/* ── Page Header ─────────────────────────────────────────── */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-heading-md text-01">{title}</h1>
          <p className="font-mono text-mono-12 text-03">
            {subParts.join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {isPaused ? (
            <Button
              variant="secondary"
              icon={<Play aria-hidden="true" />}
              loading={resume.isPending}
              disabled={busy}
              title={
                resume.isError
                  ? "This binding could not be resumed."
                  : undefined
              }
              onClick={() => resume.mutate()}
            >
              Resume binding
            </Button>
          ) : (
            <Button
              variant="secondary"
              icon={<Pause aria-hidden="true" />}
              disabled={busy || !binding}
              onClick={() => setConfirmingPause(true)}
            >
              Pause binding
            </Button>
          )}

          <Button variant="secondary" asChild>
            <Link href={`/provider/bindings/${bindingId}/configuration`}>
              <Settings aria-hidden="true" className="size-[15px]" />
              Configure
            </Link>
          </Button>
        </div>
      </header>

      {/* ── Tiles ───────────────────────────────────────────────── */}
      {/*
        The design draws its value at 32px; every tile on the design overrides it to
        24 because five of them share one row. There is no 24px step in the
        mono scale and this screen does not own `tailwind.config.js`, so the
        nearest real token (`mono-xl`, 26px) is applied over the component's
        default. The design also recolours each tile's Sub, which `MetricTile`
        fixes at `text-02`. Both are component gaps.
      */}
      <section className="grid w-full grid-cols-1 gap-3.5 mobile:grid-cols-2 tablet:grid-cols-5">
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl [&>p:nth-child(3)]:text-01"
          label="Calls 24h"
          value={count(calls24)}
          sub={trend(calls24, callsPrev)}
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl [&>p:nth-child(3)]:text-01"
          label="Quality 24h"
          value={DASH}
          sub={DASH}
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl [&>p:nth-child(3)]:text-01"
          label="p95 latency"
          value={DASH}
          sub={binding ? `vs ${count(binding.timeoutMs)}ms timeout` : DASH}
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl [&>p:nth-child(3)]:text-01"
          label="Share of tool"
          value={DASH}
          sub={DASH}
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl [&>p:nth-child(3)]:text-01"
          label="Earnings today"
          value={earnedToday === undefined ? DASH : formatMoney(earnedToday)}
          sub={DASH}
        />
      </section>

      {/* ── Row ────────────────────────────────────────────────── */}
      <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              {/*
                "Window in flight" is the design's copy and belongs to an
                OPEN window (`IN_PROGRESS` in an earlier API). A window is now a
                real, per-binding row opened only once this binding has
                actually served a call, so a fresh binding with no traffic
                yet has no window at all — an undrawn state, retitled rather
                than mislabelled.
              */}
              <PanelTitle>
                {windowIsOpen ? "Window in flight" : "Latest closed window"}
              </PanelTitle>
              <PanelDescription>
                {slaWindow
                  ? `${slaWindow.label} · opened ${stamp(slaWindow.openedAt)}`
                  : DASH}
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>

          <PanelBody className="gap-4 p-5">
            {/*
              The window's own `minVerifiedCalls` IS the real
              slashing minimum sample — no longer a substitution against
              `totalCalls`. The "NOT YET SLASHABLE" chip and its hint stay
              omitted here regardless: `GetSlaWindowResponseDto.slashable`
              would answer that directly, but this panel reads the list
              row's own counters, not the per-window live-position endpoint
              (see the file docstring) — the live SLA position screen is where that state is drawn.
            */}
            <WindowGauge
              label="verified calls"
              value={slaWindow?.verifiedCalls ?? 0}
              max={slaWindow?.minVerifiedCalls ?? 0}
              tone="primary"
            />

            {/*
              The design binds `$success-500` on this instance; `Meter` exposes
              warning / primary / teal only, so the fill is recoloured from the
              outside rather than by editing a shared component this screen
              does not own.
            */}
            <Meter
              className={
                withinSla
                  ? "[&_[role=progressbar]>div]:bg-success-500"
                  : "[&_[role=progressbar]>div]:bg-danger-500"
              }
              label="Observed failure rate"
              amount={rateAmount}
              percent={ratePercent}
              note={rateNote}
            />
          </PanelBody>
        </Panel>

        <Panel className="w-full tablet:w-[520px] tablet:shrink">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Routing share</PanelTitle>
              <PanelDescription>
                score components, so a share can be argued with rather than
                accepted
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>

          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            <Table
              caption="Routing score components"
              columns={scoreColumns}
              rows={scoreRows}
              total={{
                label: "TOTAL",
                values: { weight: DASH, value: DASH, contribution: DASH },
              }}
            />
          </PanelBody>
        </Panel>
      </section>

      {/* ── Note ───────────────────────────────────────────────── */}
      <aside className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-4">
        <Info
          aria-hidden="true"
          className="mt-0.5 size-[15px] shrink-0 text-03"
        />
        <p className="text-body-13 text-02">
          Pausing halts window accrual with no routing penalty. The confirmation
          states exactly what pausing does to the window now in flight before
          the button does anything.
        </p>
      </aside>

      {/*
        The Note promises a confirmation that says what pausing does to the
        window now in flight, and the design draws no such dialog anywhere —
        so this copy is ours, not the design's. It
        exists because rule 4 of Foundations makes stop / tell / ask three
        different regions: pausing is a stop, and a stop is asked for.
      */}
      {/*
        Mounted only while it is open, rather than left mounted with
        `open={false}`.

        `DialogContent` closes through Radix `Presence`, which waits for the
        exit animation to report back before unmounting. Measured on this
        screen: after a successful pause the node sits at
        `data-state="closed"` with `animation-name: exit`, `opacity: 1` and a
        460x176 box **indefinitely** — the dialog and its overlay stay on top
        of the page and swallow every click. `dialog.tsx` is shared and this
        screen does not own it, so the fix here is to stop asking Presence to
        unmount anything: React removes the subtree outright. The exit
        animation is the price; a permanently stuck modal is not.
      */}
      {confirmingPause ? (
        <Dialog
          open
          onOpenChange={(open) => !open && setConfirmingPause(false)}
        >
          <DialogContent className="max-w-[460px]">
            <DialogHeader>
              <DialogTitle>Pause binding</DialogTitle>
              <DialogDescription className="text-body-13 text-02">
                {slaWindow && windowIsOpen
                  ? `Window ${slaWindow.label} keeps the ${count(slaWindow.verifiedCalls)} verified calls it has already accrued. No further calls accrue to it while this binding is paused. There is no routing penalty and nothing already earned changes.`
                  : "No window is accruing for this binding right now. There is no routing penalty and nothing already earned changes."}
              </DialogDescription>
            </DialogHeader>

            {pause.isError ? (
              <p className="text-body-13 text-danger-500">
                This binding could not be paused. It may already have stopped
                serving.
              </p>
            ) : null}

            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmingPause(false)}
                disabled={pause.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={<Pause aria-hidden="true" />}
                loading={pause.isPending}
                onClick={() => pause.mutate()}
              >
                Pause binding
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
