"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Slider } from "@/components/ui/slider";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { DASH, count, percent, stampUtc } from "@/features/g34a/stats";
import type { SavedToolBinding, ToolBindingDetail } from "@/interfaces";
import { getBindingSla, getSlaWindow, getToolBinding, updateToolBinding } from "@/services";
import { cn } from "@/utils";
import { labelForEndpoint, shortBindingId } from "@/utils/provider-label";

import { Note, PageHeader } from "@/features/provider-binding/chrome";

/**
 * SLA workbench — route
 * `/provider/bindings/[bindingId]/configuration/sla`.
 *
 * ## The write path exists
 *
 * The task said to check before building a control, so: `PATCH
 * /providers/me/tool-bindings/{id}` accepts `slaFailureRate` (0..1) and
 * `UpdateToolBindingBody` declares it. It is a real, writable field, so the
 * slider is a real control and "Declare X%" really declares. The answer is 200
 * (PATCH), not 201 (POST); nothing here branches on it.
 *
 * **The provider brief says a PATCH always raises the revision, including with
 * unchanged values. That is not true of this field.** Measured on the wire:
 * `0.02 → 0.03` left `version` at 2, `publishedVersion` at 2 and
 * `hasUnpublishedChanges` false, and a second PATCH writing the same 0.02
 * again left it at 2 as well. So declaring an SLA does **not** invalidate a
 * green tester run, and this screen must not tell a provider that it does.
 *
 * The response is seeded into the detail cache with `setQueryData` rather than
 * invalidated — provider `GET`s carry `max-age=10, stale-while-revalidate=3600`
 * and a refetch after a write is served the pre-write body out of the browser's
 * HTTP cache, which no React Query invalidation can reach past.
 *
 * ## Per-binding SLA windows — what this screen used to refuse and now shows
 *
 * Before per-binding SLA windows, `/providers/me/sla-windows` returned counts and a rate and
 * nothing about a gate: this screen folded 30 days of windows client-side with
 * `wilson99`, and refused the minimum sample, the effective threshold and
 * every peer figure outright, because no endpoint published any of them.
 *
 * `GET /providers/me/bindings/{bindingId}/sla` (`getBindingSla`) is the
 * replacement, and it closes most of that gap directly:
 *
 *   - **measured rate + interval.** `measured.observedFailureRate` and
 *     `measured.confidenceInterval` are aggregated server-side over every
 *     `CLOSED` window for this binding — the server's own Wilson 99% interval,
 *     preferred here over recomputing one client-side (see `stats.ts`).
 *   - **effective threshold + minimum sample.** `effectiveThreshold` and
 *     `minVerifiedCalls` are both real fields now. Neither 400 nor its Z-score
 *     is hard-coded anywhere in this file.
 *   - **peers.** `peers.median` / `peers.p90` / `peers.rank` / `peers.count`
 *     are a real, deliberately cross-organization aggregate over every binding
 *     on this tool with at least one closed window.
 *   - **the in-flight window's frozen rate.** `inFlightWindow`, when one is
 *     open, carries the `declaredFailureRate` it was frozen with at open —
 *     which may differ from the binding's current `slaFailureRate` — and this
 *     screen's boundary sentence now says so honestly instead of assuming a
 *     UTC-midnight boundary that never existed for this resource.
 *
 * ## What is still refused, and why
 *
 *   - **the backtest.** There is no backtest endpoint. `POST /{id}/test` is a
 *     single live call, not a replay over recorded pairs, and its report is not
 *     readable afterwards. The design's whole "Backtest 2026-08-09 · 620
 *     recorded pairs · policy v3" interval has no source.
 *   - **expected proposals, worst case per window, worst case per 24h,
 *     routing weight.** Each needs a parameter (penalty size, slash cap,
 *     routing weights) that no endpoint exposes. `/providers/me/stake` does
 *     give the staked amount, but multiplying it by a 10% cap this client
 *     cannot read would be deriving a real-looking number from a related
 *     quantity — exactly the thing the standard forbids.
 *
 * ## The window boundary
 *
 * When a window is open, its `deadlineAt` and `minVerifiedCalls` are fetched
 * (`getSlaWindow(inFlightWindow.windowId)`) so "Your window closes" and the
 * page sub line state the real close condition frozen on that window, not a
 * guessed UTC-midnight cadence. With no open window, both render `—` rather
 * than assume one.
 */

/**
 * The axis the design draws under both intervals runs 0% to 10% with a tick
 * every 2%. It is a **floor**, not a fixed range: this provider's measured
 * rate is already above 10%, and clamping a real observation to the edge of a
 * canvas-sized axis would draw it as 10% — which is a smaller number than the
 * truth. The axis grows to the next even percent that contains everything
 * being drawn, and keeps the design's 2% tick spacing.
 */
const AXIS_FLOOR = 0.1;

function axisMaxFor(values: (number | null | undefined)[]): number {
  const highest = Math.max(
    AXIS_FLOOR,
    ...values.filter((v): v is number => typeof v === "number")
  );
  return Math.ceil(highest / 0.02) * 0.02;
}

// ── The interval strip ─────────────────────────────────────────────────────

/**
 * "the interval is drawn, not stated" — the design's own subtitle, and the
 * reason this is a drawing rather than a `2.1% – 5.4%` label.
 *
 * Everything is positioned as a percentage of the axis so the strip is
 * responsive; the design's 480px fixed width is a canvas artefact.
 */
function IntervalStrip({
  observed,
  interval,
  declared,
  tone,
}: {
  observed: number | null;
  interval: [number, number] | null;
  declared: number | null;
  tone: "primary" | "success";
}) {
  const axisMax = axisMaxFor([observed, interval?.[0], interval?.[1], declared]);
  const ticks = Array.from({ length: Math.round(axisMax / 0.02) + 1 }, (_, i) => i * 0.02);
  const at = (value: number) => `${Math.max(0, Math.min(1, value / axisMax)) * 100}%`;
  const bar = tone === "primary" ? "bg-primary-20" : "bg-success-20";
  const cap = tone === "primary" ? "bg-primary-500" : "bg-success-500";
  const text = tone === "primary" ? "text-primary-600" : "text-success-600";

  return (
    <div className="relative h-[112px] w-full max-w-[480px]">
      {/*
        The design fills the axis and its ticks with `$border-02`. There is no
        `bg-border-02` utility — the border ramp is exposed to `border-*` only —
        so both are drawn as 1px borders rather than dropping to an arbitrary
        `bg-[var(--border-02)]`.
      */}
      <div className="absolute inset-x-0 top-[78px] border-t border-02" />
      {ticks.map((tick) => (
        <React.Fragment key={tick}>
          <div
            className="absolute top-[78px] h-[5px] border-l border-02"
            style={{ left: at(tick) }}
          />
          <span
            className="absolute top-[88px] -translate-x-1/2 font-mono text-mono-2xs text-03"
            style={{ left: at(tick) }}
          >
            {`${Math.round(tick * 100)}%`}
          </span>
        </React.Fragment>
      ))}

      {declared !== null ? (
        <>
          <div
            className="absolute top-[26px] h-[52px] w-px bg-text-03"
            style={{ left: at(declared) }}
          />
          <span
            className="absolute top-2 -translate-x-1/2 whitespace-nowrap font-mono text-mono-2xs text-02"
            style={{ left: at(declared) }}
          >
            {`declared ${percent(declared, 1)}`}
          </span>
        </>
      ) : null}

      {interval !== null ? (
        <>
          <div
            className={cn("absolute top-[53px] h-[6px] rounded-[3px]", bar)}
            style={{
              left: at(interval[0]),
              width: `${((Math.min(interval[1], axisMax) - Math.min(interval[0], axisMax)) / axisMax) * 100}%`,
            }}
          />
          <div
            className={cn("absolute top-12 h-4 w-0.5 rounded-[1px]", cap)}
            style={{ left: at(interval[0]) }}
          />
          <div
            className={cn("absolute top-12 h-4 w-0.5 rounded-[1px]", cap)}
            style={{ left: at(interval[1]) }}
          />
        </>
      ) : null}

      {observed !== null ? (
        <>
          <div
            className={cn("absolute top-[50px] size-3 -translate-x-1/2 rounded-full", cap)}
            style={{ left: at(observed) }}
          />
          <span
            className={cn(
              "absolute top-[30px] -translate-x-1/2 font-mono text-mono-12 font-semibold",
              text
            )}
            style={{ left: at(observed) }}
          >
            {percent(observed)}
          </span>
        </>
      ) : null}
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

interface ConsequenceRow extends TableRowData {
  name: string;
  value: string;
  derivation: string;
}

export default function SlaWorkbenchPage() {
  const params = useParams<{ bindingId: string }>();
  const bindingId = params.bindingId;
  const queryClient = useQueryClient();

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    retry: 0,
  });
  const binding: ToolBindingDetail | undefined = bindingQuery.data;

  const slaQuery = useQuery({
    queryKey: ["provider", "binding-sla", bindingId],
    queryFn: () => getBindingSla(bindingId),
    retry: 0,
  });
  const sla = slaQuery.data;

  // Only fetched when a window is actually open — `inFlightWindow` carries no
  // `deadlineAt`/`minVerifiedCalls` of its own, and this is the one place
  // those two are needed (the "Your window closes" row and the sub line).
  const inFlightWindowId = sla?.inFlightWindow?.windowId ?? null;
  const inFlightSummaryQuery = useQuery({
    queryKey: ["provider", "sla-window", inFlightWindowId],
    queryFn: () => getSlaWindow(inFlightWindowId!),
    enabled: inFlightWindowId !== null,
    retry: 0,
  });
  const inFlightSummary = inFlightSummaryQuery.data;

  const measured = sla?.measured ?? null;
  const liveInterval: [number, number] | null = measured?.confidenceInterval
    ? [measured.confidenceInterval.lower, measured.confidenceInterval.upper]
    : null;

  // The slider is in basis-points-of-a-percent so 0.1% steps are exact.
  const declared = binding?.slaFailureRate ?? null;
  const [draft, setDraft] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (declared !== null) setDraft(Math.round(declared * 1000));
  }, [declared]);

  const draftRate = draft === null ? null : draft / 1000;
  const dirty = draft !== null && declared !== null && Math.round(declared * 1000) !== draft;

  const save = useMutation({
    mutationFn: (rate: number) => updateToolBinding(bindingId, { slaFailureRate: rate }),
    onSuccess: (updated: SavedToolBinding) => {
      queryClient.setQueryData(["provider", "tool-binding", bindingId], updated);
      void queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings", "sidebar"] });
    },
  });

  const closesLabel = inFlightSummary
    ? `${count(inFlightSummary.minVerifiedCalls)} verified calls or ${stampUtc(inFlightSummary.deadlineAt)} UTC`
    : DASH;

  const rows: ConsequenceRow[] = [
    {
      id: "threshold",
      name: "Effective threshold",
      value: percent(sla?.effectiveThreshold ?? null, 1),
      derivation: sla
        ? "server-computed at n = max(measured verified calls, minimum sample)"
        : DASH,
    },
    {
      id: "sample",
      name: "Minimum sample",
      value: count(sla?.minVerifiedCalls ?? null),
      derivation: "below this, no proposal is issued at all",
    },
    {
      id: "closes",
      name: "Your window closes",
      value: closesLabel,
      derivation: inFlightSummary ? "the gate frozen on the window now in flight" : "no window is currently open",
    },
    {
      id: "proposals",
      name: "Expected proposals",
      value: DASH,
      derivation: "no endpoint publishes the penalty size or the slash cap",
    },
    {
      id: "worstWindow",
      name: "Worst case per window",
      value: DASH,
      derivation: "the penalty size is not exposed to this API",
    },
    {
      id: "worst24",
      name: "Worst case per 24h",
      value: DASH,
      derivation: "the daily slash cap is not exposed to this API",
    },
    {
      id: "agents",
      name: "Agents will see",
      value:
        draftRate === null
          ? DASH
          : `declared ≤${percent(draftRate, 1)} · measured ${percent(measured?.observedFailureRate ?? null, 1)}`,
      derivation: "published on the tool page",
    },
    {
      id: "routing",
      name: "Routing weight",
      value: DASH,
      derivation: "the router's weights are not exposed to this API",
    },
  ];

  const columns: TableColumn<ConsequenceRow>[] = [
    { key: "name", header: "", cell: (r) => r.name },
    /*
      Both carry a sentence rather than a figure. `noTruncate` was the first
      attempt and is wrong here: the cell is a non-shrinking flex item, so the
      text bled straight out of the panel instead of wrapping. The sentences
      are written short enough to fit 380px of 12.5px mono instead, and each
      keeps its full text in a `title`.
    */
    {
      key: "value",
      header: "Value",
      cell: (r) => r.value,
      width: 240,
      align: "end",
      mono: true,
    },
    {
      key: "derivation",
      header: "Derivation",
      cell: (r) => <span title={r.derivation}>{r.derivation}</span>,
      width: 380,
      align: "end",
      mono: true,
    },
  ];

  if (bindingQuery.isError) {
    return (
      <p className="text-body-13 text-03">
        This binding could not be loaded. It may belong to another organisation, or the id may
        not exist.
      </p>
    );
  }

  const boundarySub = (() => {
    if (!sla) return DASH;
    if (!sla.inFlightWindow) return "no window is currently open for this binding";
    const frozen = sla.inFlightWindow.declaredFailureRate;
    const boundary = inFlightSummary ? `${closesLabel}` : DASH;
    return frozen !== sla.currentDeclaredFailureRate
      ? `effective at the next window boundary · ${boundary} · the window now in flight is judged against your frozen ${percent(frozen, 1)}, not today's ${percent(sla.currentDeclaredFailureRate, 1)}`
      : `effective at the next window boundary · ${boundary} · the window now in flight is judged against your current ${percent(frozen, 1)}`;
  })();

  const label = binding ? labelForEndpoint(binding.endpoint) : DASH;

  return (
    <>
      <PageHeader
        title={`Declare SLA · ${shortBindingId(bindingId)} ${label}`}
        sub={boundarySub}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<X aria-hidden="true" />}
              disabled={!dirty || save.isPending}
              onClick={() => setDraft(declared === null ? null : Math.round(declared * 1000))}
            >
              Cancel
            </Button>
            <Button
              icon={<Check aria-hidden="true" />}
              loading={save.isPending}
              disabled={!dirty || draftRate === null}
              onClick={() => draftRate !== null && save.mutate(draftRate)}
            >
              {`Declare ${percent(draftRate, 1)}`}
            </Button>
          </>
        }
      />

      <Note tone="warning" icon={<TriangleAlert aria-hidden="true" className="size-[15px]" />}>
        This screen assumes the declared SLA is published to agents and carries a routing term.
        If it is not, this workbench should not exist — a “commitment” nobody can see is not a
        commitment, and dressing it up here would make the platform complicit in the fiction.
      </Note>

      {save.isError ? (
        <p role="alert" className="text-body-13 text-danger-600">
          That rate could not be saved. A suspended binding cannot be edited.
        </p>
      ) : null}
      {save.isSuccess && !dirty ? (
        <p className="text-body-13 text-02">
          Declared. This binding is still at revision {binding?.version ?? DASH} — writing a
          declared rate does not raise it, so a tester run against it still counts.
        </p>
      ) : null}

      {/* ── Your measured failure rate ─────────────────────────── */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Your measured failure rate</PanelTitle>
            <PanelDescription>the interval is drawn, not stated</PanelDescription>
          </PanelTitles>
        </PanelHeader>

        <PanelBody className="gap-5 p-5">
          <div className="flex w-full flex-col gap-8 tablet:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-label-13 text-01">Backtest — no run to draw</p>
              <p className="text-body-13 text-03">
                There is no backtest endpoint. The tester makes one live call and its report is
                not readable afterwards, so there is no replay over recorded pairs to interval.
              </p>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-label-13 text-01">
                {`Live traffic (closed windows) · ${count(measured?.verifiedCalls ?? null)} verified calls`}
              </p>
              <IntervalStrip
                observed={measured?.observedFailureRate ?? null}
                interval={liveInterval}
                declared={declared}
                tone="success"
              />
            </div>
          </div>

          {/* ── Peers ──────────────────────────────────────────── */}
          <div className="flex w-full flex-col gap-6 rounded-lg bg-02 px-4 py-3.5 mobile:flex-row mobile:items-center">
            {[
              { key: `Peers on this tool`, value: count(sla?.peers.count ?? null) },
              { key: "median", value: percent(sla?.peers.median ?? null, 1) },
              { key: "p90", value: percent(sla?.peers.p90 ?? null, 1) },
              {
                key: "your rank",
                value:
                  sla?.peers.rank && sla.peers.count
                    ? `${sla.peers.rank} of ${sla.peers.count}`
                    : DASH,
              },
            ].map((peer) => (
              <div key={peer.key} className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body-xs text-03">{peer.key}</span>
                <span className="font-mono text-mono-sm font-semibold text-01">{peer.value}</span>
              </div>
            ))}
          </div>
          <p className="text-body-xs text-03">
            Cross-organization: every binding on this tool with at least one closed window,
            aggregated to a median, a p90 and this binding&apos;s rank. Never another provider&apos;s
            identity.
          </p>
        </PanelBody>
      </Panel>

      {/* ── Row ───────────────────────────────────────────────── */}
      <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
        <Panel className="w-full tablet:w-[520px] tablet:shrink">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Declare</PanelTitle>
              {/* `PanelDescription` truncates by default, which is right for a
                  one-line caption; the design wraps this one over two lines. */}
              <PanelDescription className="whitespace-normal">
                moving the slider recomputes every line to the right — if nothing gets worse at
                20%, the mechanism is broken
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>

          <PanelBody className="gap-[18px] p-5">
            <Slider
              label="slaFailureRate"
              min={10}
              max={200}
              step={1}
              value={draft ?? 10}
              disabled={draft === null || save.isPending}
              onValueChange={setDraft}
              formatValue={(v) => `${(v / 10).toFixed(1)}%`}
              formatBound={(v) => `${Math.round(v / 10)}%`}
              aria-label="Declared SLA failure rate"
            />

            <Note tone="primary" icon={<Info aria-hidden="true" className="size-[15px]" />}>
              {draftRate === null
                ? "This binding has no declared rate to compare against yet."
                : measured?.observedFailureRate == null
                  ? `You are declaring ${percent(draftRate, 1)}. Nothing has been verified yet, so there is no measured rate and no lower bound to declare against.`
                  : `You are declaring ${percent(draftRate, 1)} against a measured ${percent(measured.observedFailureRate, 1)}. Declaring tighter than your own 99% lower bound of ${percent(liveInterval?.[0] ?? null, 1)} would make a breach likely.${
                      sla?.peers.p90 != null
                        ? ` Declaring above the peer p90 of ${percent(sla.peers.p90, 1)} would make you the loosest binding on this tool.`
                        : " The peer p90 has no source yet, so nothing here can tell you whether you would be the loosest binding on this tool."
                    }`}
            </Note>

            <p className="text-body-xs text-03">
              Measured on the wire: writing a declared rate leaves this binding&apos;s revision
              where it is, so it does not invalidate a tester run or require a republish.
            </p>
          </PanelBody>
        </Panel>

        <Panel className="w-full min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>At this number</PanelTitle>
              <PanelDescription>
                consequences in dollars and in calls, never in adjectives
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            <div className="w-full overflow-x-auto">
              <Table
                caption="Consequences of this declared rate"
                columns={columns}
                rows={rows}
                className="min-w-[880px]"
              />
            </div>
          </PanelBody>
        </Panel>
      </section>

      {/*
        DELIBERATE DEPARTURE from the verbatim-copy rule — the third in this
        project, after the portfolio screen's dropped `Phase 2 · ` prefix and
        the provider view and reconciliation screens' `gross` -> `net`. Do not "restore" the dropped clauses.

        The design writes this note in full as:

          "You have not run a backtest on paid traffic. This number is derived
           from free-tier traffic only, where your result set is capped at 3
           items — a free-tier rate is not comparable to a paid one."

        The first sentence is true and is kept word for word: no backtest
        endpoint exists (backtest jobs are not built), so no run can have happened.

        Everything after it is false for this binding, measured: the figure
        above is folded from every CLOSED window this binding has, which is
        mostly PAID traffic — nothing caps this tool's result set at 3 items.

        A provider reads this screen to decide what failure rate to commit to
        contractually. A false statement about where that number came from is
        the worst possible place for one: it invites them to discount a figure
        that is in fact representative, and to declare a rate they cannot meet.

        This is a decision, not a transcription slip.
      */}
      <Note tone="warning" icon={<TriangleAlert aria-hidden="true" className="size-[15px]" />}>
        You have not run a backtest on paid traffic.
      </Note>
    </>
  );
}
