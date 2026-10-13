"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Flag, GitBranch, Pause, Play } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
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
import { Note } from "@/features/provider-binding/chrome";
import {
  requestRows,
  responseRows,
  type RequestRow,
  type ResponseRow,
} from "@/features/provider-binding/mapping-rows";
import { DASH, count, percent, trend } from "@/features/g34a/stats";
import { isCredited, rowsOf, utcDay, utcDayStart, type ProviderCallRow } from "@/features/g34a/calls";
import type { ToolBindingDetail } from "@/interfaces";
import {
  exportProviderCalls,
  getToolBinding,
  listToolBindings,
  pauseToolBinding,
  resumeToolBinding,
} from "@/services";
import { formatMoney } from "@/utils/money";
import { labelForEndpoint } from "@/utils/provider-label";

/**
 * Binding and traffic — route `/provider/traffic`.
 *
 * The 56px Bar is the `(minimal)` layout's, with its copy from that layout's
 * pathname map. This file renders the design's "Body" and nothing above it.
 *
 * ## Which binding
 *
 * The frame is about **one** binding (`ais_lookup`) and the route names none —
 * there is no `[bindingId]` segment on `/provider/traffic` and the frame draws
 * no picker. So the screen addresses the binding that is currently serving,
 * falls back to the first in list order, latches that choice for the session,
 * and accepts `?bindingId=<uuid>` to address another. The query parameter is a
 * deep link, not a control: nothing on screen offers it, because nothing in
 * the design does.
 *
 * ## Where the per-binding numbers come from
 *
 * `/providers/me/traffic` and `/providers/me/quality` are **provider-wide**
 * daily aggregates with no tool or binding dimension, and this provider serves
 * two bindings — so their figures are not this binding's and are not used.
 * `/providers/me/calls/export` is the only endpoint that carries a call, and
 * every call row carries its `tool_id`, so the tiles, the quality figure and
 * the daily-ceiling usage are all folded out of it, filtered to this binding's
 * tool. See `@/features/g34a/calls`.
 *
 * ## What has no source, and is a dash
 *
 * - **p95 latency.** `p50LatencyMs`/`p95LatencyMs` are hard-coded `null` in
 *   `ProviderTrafficService`; there is no per-day latency column to read. The
 *   tile's Sub still reads against the binding's real `timeoutMs`.
 * - **Share of tool**, and the whole peer table in the "Traffic share" rail
 *   panel. Naming the other providers on a tool needs a public catalogue, and
 *   there is no catalogue controller. The panel keeps the design's note,
 *   because the note is about the mechanism and stays true; the figures are
 *   dashes.
 * - **maxRps used** and **p95 vs timeout** in the ceilings table. A
 *   per-second observation is not in any response.
 * - **Flag a mapping problem.** `POST /disputes` exists on the wire, but
 *   `src/services/` has no disputes service and a screen may not add one; the
 *   button is therefore disabled rather than enabled-and-inert.
 *
 * ## Pause, and the stale read behind it
 *
 * `pause`/`resume` both answer **201** and return the whole binding. Nothing
 * here branches on the status code. The response is written straight into the
 * detail cache with `setQueryData` rather than invalidated, because provider
 * `GET`s carry `Cache-Control: private, max-age=10, stale-while-revalidate=3600`
 * and a refetch fired after a write is served the pre-write body out of the
 * browser's HTTP cache — invalidating a React Query key cannot reach past
 * that. Measured on this screen: seeded from the 201, the header flipped in
 * 192ms, 533ms, 735ms and 848ms across four presses, and `curl` confirmed the
 * server each time. The trap is real and was caught here too — a full page
 * RELOAD one minute after a resume rendered the pre-write PAUSED body, while
 * `curl` in the same second said ACTIVE. Nothing on this side of the wire can
 * fix a first paint; the seed is what makes the press itself honest.
 *
 * The design draws only "Pause this binding". A paused binding needs the way
 * back, so the same control becomes **"Resume this binding"** / **"Resume
 * <host>"** when `status === "PAUSED"`. Those two strings are ours.
 */

const REFRESH_MS = 60_000;

/** Bucketed so the query key changes once a minute instead of every render. */
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

interface CeilingRow extends TableRowData {
  ceiling: string;
  value: string;
  used: string;
}

interface ShareRow extends TableRowData {
  binding: string;
  quality: string;
  share: string;
}

function BindingAndTrafficPageContent() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("bindingId");
  const queryClient = useQueryClient();
  const nowMs = useMinuteTick();

  const listQuery = useQuery({
    queryKey: ["provider", "tool-bindings", "traffic-screen"],
    queryFn: () => listToolBindings({ limit: 50 }),
    retry: 0,
  });

  /*
    No `[bindingId]` segment and no picker in the frame, so the screen picks:
    the binding that is actually serving, else the first one. "Serving" first
    because the frame is about traffic and a paused binding has none — landing
    on the paused one would show a screen of zeros that are true and useless.

    The choice is then LATCHED. Recomputing it every render meant that pausing
    the binding you are looking at moved the screen to a different one, because
    it was no longer the ACTIVE match — pressing pause silently changed the
    subject. Measured, and fixed here.
  */
  const [latchedId, setLatchedId] = React.useState<string | null>(null);
  const firstChoice =
    listQuery.data?.items.find((item) => item.status === "ACTIVE")?.id ??
    listQuery.data?.items[0]?.id ??
    null;
  React.useEffect(() => {
    if (latchedId === null && firstChoice !== null) setLatchedId(firstChoice);
  }, [latchedId, firstChoice]);

  const bindingId = requestedId ?? latchedId ?? firstChoice;

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId as string),
    enabled: bindingId !== null,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const binding: ToolBindingDetail | undefined = bindingQuery.data;

  /*
    Three UTC days is the smallest window that answers every tile: today (for
    earnings and the daily ceiling), the trailing 24h, and the 24h before it.
    `to` is exclusive, so it is tomorrow.
  */
  const range = React.useMemo(() => {
    if (nowMs === null) return null;
    const dayMs = 86_400_000;
    return {
      from: utcDay(utcDayStart(nowMs) - 2 * dayMs),
      to: utcDay(utcDayStart(nowMs) + dayMs),
    };
  }, [nowMs]);

  const callsQuery = useQuery({
    queryKey: ["provider", "calls-export", range?.from, range?.to],
    queryFn: () => exportProviderCalls({ from: range!.from, to: range!.to }),
    enabled: range !== null,
    placeholderData: (previous) => previous,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });

  const mine: ProviderCallRow[] = React.useMemo(() => {
    const toolId = binding?.toolId;
    if (!toolId) return [];
    return rowsOf(callsQuery.data).filter((row) => row.toolId === toolId);
  }, [callsQuery.data, binding?.toolId]);

  const figures = React.useMemo(() => {
    if (nowMs === null || !binding) return null;
    const dayStart = utcDayStart(nowMs);
    const h24 = nowMs - 86_400_000;
    const h48 = nowMs - 2 * 86_400_000;

    let calls24 = 0;
    let callsPrev = 0;
    let passed = 0;
    let failed = 0;
    let callsToday = 0;
    // Minor units, summed as decimals — never as JS numbers.
    let earnedToday = new Decimal(0);
    let pendingToday = new Decimal(0);

    for (const row of mine) {
      const at = new Date(row.createdAt).getTime();
      if (Number.isNaN(at)) continue;
      if (at >= h24) {
        calls24 += 1;
        if (row.verdict === "PASS") passed += 1;
        if (row.verdict === "FAIL") failed += 1;
      } else if (at >= h48) {
        callsPrev += 1;
      }
      if (at >= dayStart) {
        callsToday += 1;
        const amount = new Decimal(row.providerAmount.amount || "0");
        if (isCredited(row)) earnedToday = earnedToday.plus(amount);
        else if (row.status === "VERIFYING") pendingToday = pendingToday.plus(amount);
      }
    }

    const judged = passed + failed;
    const asset = mine[0]?.providerAmount.asset ?? binding.price.asset;
    const decimals = mine[0]?.providerAmount.decimals ?? binding.price.decimals;

    return {
      calls24,
      callsPrev,
      passed,
      failed,
      quality: judged > 0 ? passed / judged : null,
      callsToday,
      earnedToday: { amount: earnedToday.toFixed(0), asset, decimals },
      pendingToday: { amount: pendingToday.toFixed(0), asset, decimals },
    };
  }, [mine, nowMs, binding]);

  // ── Pause / resume ───────────────────────────────────────────────────────

  const applyWrite = (updated: ToolBindingDetail) => {
    queryClient.setQueryData(["provider", "tool-binding", bindingId], updated);
    void queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings", "sidebar"] });
    void queryClient.invalidateQueries({
      queryKey: ["provider", "tool-bindings", "traffic-screen"],
    });
  };

  const pause = useMutation({
    mutationFn: () => pauseToolBinding(bindingId as string),
    onSuccess: applyWrite,
  });
  const resume = useMutation({
    mutationFn: () => resumeToolBinding(bindingId as string),
    onSuccess: applyWrite,
  });

  const isPaused = binding?.status === "PAUSED";
  const busy = pause.isPending || resume.isPending;
  const writeError = pause.error ?? resume.error;

  // ── Rows ─────────────────────────────────────────────────────────────────

  const reqRows: RequestRow[] = React.useMemo(
    () => requestRows(binding?.requestMapping),
    [binding?.requestMapping]
  );
  const resRows: ResponseRow[] = React.useMemo(
    () => responseRows(binding?.responseMapping),
    [binding?.responseMapping]
  );

  const requestColumns: TableColumn<RequestRow & TableRowData>[] = [
    { key: "toolField", header: "Tool field", cell: (r) => r.toolField, mono: true },
    { key: "transform", header: "Transform", cell: (r) => r.transform, width: 200, align: "end", mono: true },
    { key: "upstream", header: "Your field", cell: (r) => r.upstreamField, width: 190, align: "end", mono: true },
    { key: "status", header: "Status", cell: (r) => r.status, width: 110, align: "end", mono: true },
  ];

  const responseColumns: TableColumn<ResponseRow & TableRowData>[] = [
    { key: "outputField", header: "Tool field", cell: (r) => r.outputField, mono: true },
    { key: "from", header: "From your response", cell: (r) => r.from, width: 240, align: "end", mono: true },
    { key: "status", header: "Status", cell: (r) => r.status, width: 180, align: "end", mono: true },
  ];

  /*
    The peer table needs every binding on this tool, from every provider. No
    endpoint answers that: `/providers/me/tool-bindings` is scoped to this
    organisation and there is no catalogue controller. One honest row exists —
    this binding — and it carries the quality this screen measured. The design's
    other two rows (a named competitor, an exploration slot) have no source and
    are not invented.
  */
  const shareRows: ShareRow[] = binding
    ? [
        {
          id: binding.id,
          binding: `you · ${labelForEndpoint(binding.endpoint)}`,
          quality: percent(figures?.quality ?? null, 1),
          share: DASH,
        },
      ]
    : [];

  const shareColumns: TableColumn<ShareRow>[] = [
    { key: "binding", header: "Binding", cell: (r) => r.binding, mono: true },
    { key: "quality", header: "Quality", cell: (r) => r.quality, width: 110, align: "end", mono: true },
    { key: "share", header: "Share", cell: (r) => r.share, width: 100, align: "end", mono: true },
  ];

  const ceilingRows: CeilingRow[] = binding
    ? [
        {
          id: "maxRps",
          ceiling: "maxRps",
          value: binding.maxRps === null ? DASH : count(binding.maxRps),
          used: DASH,
        },
        {
          id: "daily",
          ceiling: "Daily",
          value: binding.maxDailyCalls === null ? DASH : count(binding.maxDailyCalls),
          used: count(figures?.callsToday ?? null),
        },
        {
          id: "timeout",
          ceiling: "Timeout",
          value: `${count(binding.timeoutMs)}ms`,
          used: `p95 ${DASH}`,
        },
      ]
    : [];

  const ceilingColumns: TableColumn<CeilingRow>[] = [
    { key: "ceiling", header: "Ceiling", cell: (r) => r.ceiling, mono: true },
    { key: "value", header: "Value", cell: (r) => r.value, width: 130, align: "end", mono: true },
    { key: "used", header: "Used", cell: (r) => r.used, width: 120, align: "end", mono: true },
  ];

  // ── States that are not the screen ───────────────────────────────────────

  if (listQuery.isError || bindingQuery.isError) {
    return (
      <p className="text-body-13 text-03">
        This binding could not be loaded. It may belong to another organisation, or the id may
        not exist.
      </p>
    );
  }

  if (!listQuery.isLoading && bindingId === null) {
    return (
      <p className="text-body-13 text-03">
        You have no bindings yet, so there is no traffic to show. Register one and publish it
        first.
      </p>
    );
  }

  const label = binding ? labelForEndpoint(binding.endpoint) : DASH;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {/* 25px/600/-0.6 in the design; `heading-lg` is the nearest step. */}
          <h1 className="truncate text-heading-lg text-01">{label}</h1>
          <p className="text-body-sm leading-[1.55] text-02">
            Your binding. You wrote it in the editor, and you can change it here — republish
            when the tester is green.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <Button
            variant="secondary"
            icon={<Flag aria-hidden="true" />}
            disabled
            title="Flagging a mapping problem from here is not available yet."
          >
            Flag a mapping problem
          </Button>

          {isPaused ? (
            <Button
              variant="danger"
              icon={<Play aria-hidden="true" />}
              loading={resume.isPending}
              disabled={busy || !binding}
              onClick={() => resume.mutate()}
            >
              Resume this binding
            </Button>
          ) : (
            <Button
              variant="danger"
              icon={<Pause aria-hidden="true" />}
              loading={pause.isPending}
              disabled={busy || !binding}
              onClick={() => pause.mutate()}
            >
              Pause this binding
            </Button>
          )}
        </div>
      </header>

      {writeError ? (
        <p role="alert" className="text-body-13 text-danger-600">
          {isPaused
            ? "This binding could not be resumed. It may never have been published."
            : "This binding could not be paused. It may not be serving right now."}
        </p>
      ) : null}

      {/* ── Tiles ──────────────────────────────────────────────── */}
      {/*
        The design draws its value at 32px; the design overrides every tile to 24
        because five share a row. There is no 24px mono step and this screen
        does not own `tailwind.config.js`, so the nearest real token
        (`mono-xl`, 26px) is applied over the component's default — the same
        substitution the binding overview screen makes, so the two screens agree.
      */}
      <section className="grid w-full grid-cols-1 gap-3.5 mobile:grid-cols-2 tablet:grid-cols-5">
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl"
          label="Calls 24h"
          value={count(figures?.calls24 ?? null)}
          sub={trend(figures?.calls24 ?? null, figures?.callsPrev ?? null)}
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl [&>p:nth-child(2)]:text-teal-600"
          label="Quality"
          value={percent(figures?.quality ?? null, 1)}
          sub={
            figures
              ? `${count(figures.passed + figures.failed)} verified, ${count(figures.failed)} failed`
              : DASH
          }
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl"
          label="p95 latency"
          value={DASH}
          sub={binding ? `vs ${count(binding.timeoutMs)}ms timeout` : DASH}
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl"
          label="Share of tool"
          value={DASH}
          sub={DASH}
        />
        <MetricTile
          className="[&>p:nth-child(2)]:text-mono-xl"
          label="Earnings today"
          value={figures ? formatMoney(figures.earnedToday) : DASH}
          sub={figures ? `pending ${formatMoney(figures.pendingToday)}` : DASH}
        />
      </section>

      {/* ── Row ───────────────────────────────────────────────── */}
      <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Request mapping</PanelTitle>
                <PanelDescription>tool input → your endpoint</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              {reqRows.length > 0 ? (
                /* `ui/table.tsx` lays fixed-width numeric columns out in a
                   flex row, so a four-column table has a hard min width. The
                   design's frame is 1440; below that the table scrolls inside
                   its own box rather than scrolling the page. */
                <div className="w-full overflow-x-auto">
                  <Table
                    caption="Request mapping"
                    columns={requestColumns}
                    rows={reqRows as (RequestRow & TableRowData)[]}
                    className="min-w-[640px]"
                  />
                </div>
              ) : (
                <p className="text-body-13 text-03">
                  This binding maps nothing onto the request yet.
                </p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Response mapping</PanelTitle>
                <PanelDescription>your endpoint → the tool schema agents see</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              {resRows.length > 0 ? (
                <div className="w-full overflow-x-auto">
                  <Table
                    caption="Response mapping"
                    columns={responseColumns}
                    rows={resRows as (ResponseRow & TableRowData)[]}
                    className="min-w-[640px]"
                  />
                </div>
              ) : (
                <p className="text-body-13 text-03">
                  This binding maps nothing out of the response yet.
                </p>
              )}
            </PanelBody>
          </Panel>

          <Note tone="primary" icon={<GitBranch aria-hidden="true" className="size-[15px]" />}>
            A field mapped wrong means agents get a worse result and our checks may fail the
            call. Fix it in the editor and republish; the tester runs against your real endpoint
            first, so a bad mapping never has to reach an agent.
          </Note>
        </div>

        {/* ── Rail (440) ────────────────────────────────────────── */}
        <div className="flex w-full flex-col gap-4 tablet:w-[440px] tablet:shrink">
          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Traffic share</PanelTitle>
                <PanelDescription>how much of this tool comes to you</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              {/*
                The design's Meter needs a share. Nothing publishes one, and a
                bar drawn at 0% would read as "you get no traffic", which is
                false — so the figure is the unknown glyph and the track is not
                drawn at all.
              */}
              <div className="flex w-full flex-col gap-2">
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-label-13 text-01">Your share</span>
                  <span className="font-mono text-mono-13 text-02">
                    {DASH} of {label}
                  </span>
                </div>
                <p className="text-body-xs leading-[1.4] text-03">
                  Share follows measured quality and latency. A new binding gets an exploration
                  floor so it can build a record before it has one.
                </p>
                <p className="text-body-xs leading-[1.4] text-03">
                  Your share and the other bindings on this tool are not available yet.
                </p>
              </div>

              <div className="w-full overflow-x-auto">
                <Table
                  caption="Traffic share by binding"
                  columns={shareColumns}
                  rows={shareRows}
                  className="min-w-[340px]"
                />
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Pause</PanelTitle>
                <PanelDescription>yours to press, at any time</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <Note tone="warning" icon={<Pause aria-hidden="true" className="size-[15px]" />}>
                Pausing stops traffic to this binding within 5 seconds. Nothing else happens: no
                penalty, no effect on earnings already accrued, and no mark on your record. Use
                it when your upstream is having a bad day — we would much rather you paused than
                served errors.
              </Note>

              {isPaused ? (
                <Button
                  variant="secondary"
                  className="w-full px-3.5 py-3 text-danger-600"
                  icon={<Play aria-hidden="true" className="text-danger-600" />}
                  loading={resume.isPending}
                  disabled={busy || !binding}
                  onClick={() => resume.mutate()}
                >
                  Resume {label}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="w-full px-3.5 py-3 text-danger-600"
                  icon={<Pause aria-hidden="true" className="text-danger-600" />}
                  loading={pause.isPending}
                  disabled={busy || !binding}
                  onClick={() => pause.mutate()}
                >
                  Pause {label}
                </Button>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>Your declared ceilings</PanelTitle>
                <PanelDescription>
                  we shed traffic here rather than fail your calls
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <div className="w-full overflow-x-auto">
                <Table
                  caption="Declared ceilings"
                  columns={ceilingColumns}
                  rows={ceilingRows}
                  className="min-w-[340px]"
                />
              </div>
            </PanelBody>
          </Panel>
        </div>
      </section>
    </>
  );
}

/**
 * `useSearchParams()` opts a route out of static prerendering, and Next refuses
 * to build unless the component that reads it sits under a Suspense boundary —
 * `next build` failed on this page with "useSearchParams() should be wrapped in
 * a suspense boundary". The page has no server-rendered fallback worth drawing
 * (the whole binding and traffic view is client-fetched), so the boundary renders nothing and
 * exists only to mark the bail-out point.
 */
export default function BindingAndTrafficPage() {
  return (
    <React.Suspense fallback={null}>
      <BindingAndTrafficPageContent />
    </React.Suspense>
  );
}
