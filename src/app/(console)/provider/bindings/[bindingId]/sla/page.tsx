"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartSpline, List, Pause, Play } from "lucide-react";
import Link from "next/link";

import { BindingNav } from "@/features/provider-binding/binding-nav";
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
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { WindowGauge } from "@/components/ui/window-gauge";
import { DASH, count, elapsed, percent, stampUtc } from "@/features/g34a/stats";
import { openWindowStanding } from "@/features/provider-sla/standing";
import type {
  SlaWindow,
  SlaWindowEvidence,
  SlaWindowFailureGroup,
  SlaWindowPosition,
  ToolBindingDetail,
} from "@/interfaces";
import {
  getSlaWindow,
  getSlaWindowEvidence,
  getToolBinding,
  listSlaWindows,
  pauseToolBinding,
  resumeToolBinding,
} from "@/services";
import { cn } from "@/utils";
import { shortBindingId } from "@/utils/provider-label";

import { Note } from "@/features/provider-binding/chrome";

/**
 * Live SLA position — desktop (1440) and mobile (390) designs, route `/provider/bindings/[bindingId]/sla`.
 *
 * One file serves both widths. The `(console)` layout already puts the Mobile
 * Top Bar below tablet and the Sidebar at and above it, and both
 * chromes are always in the DOM with CSS choosing — so this file renders the
 * two bodies the same way: one tree, `tablet:` variants, plus the mobile
 * frame's **Sticky action** bar, which has no desktop counterpart and is
 * `tablet:hidden`.
 *
 * ## Per-binding SLA windows — what this screen used to refuse and now shows
 *
 * Before per-binding SLA windows there was no `sla_windows` table: a "window" was a rolling
 * UTC calendar day folded out of `payment_intents` at request time, scoped to
 * the whole provider, and this screen's own docstring said so and refused —
 * with `DASH` — every figure that fold could not honestly produce: the
 * effective threshold, the sample gate, the error budget, the projection at
 * close, and a per-window failure breakdown by rule or by agent.
 *
 * Per-binding SLA windows replaced the fold with real `sla_windows` / `sla_window_calls`
 * tables, one window per **binding**, and three endpoints this screen now
 * reads in full:
 *
 * - `GET /providers/me/sla-windows?bindingId=` finds this binding's current
 *   window (the `OPEN` one, or the newest `CLOSED` one if none is open).
 * - `GET /providers/me/sla-windows/{windowId}` (`getSlaWindow`) is the live
 *   position: `state`, `slashable`, the server's own Wilson 99% interval,
 *   `effectiveThresholdAtClose`, the error budget, and the projection at
 *   close (`projectedFailureRate`/`projectedBreach`). All of it real, all of
 *   it computed from the same stored counters this screen also renders —
 *   nothing here re-derives a number the server already published.
 * - `GET /providers/me/sla-windows/{windowId}/evidence` gives
 *   `failuresByReasonCode` and `failuresByAgentId` directly — an evidence
 *   call now carries `reasonCode` and `agentId`, so "Recent failures" no
 *   longer has to fall back to grouping by verification policy.
 *
 * The gauge is drawn against `minVerifiedCalls`, the window's own real sample
 * gate — not `totalCalls` standing in for a number nothing published, and not
 * a hard-coded 400.
 *
 * ## What is still not shown, and why
 *
 * - **The penalty cap** ("if breached, capped at $5.00" in the mockup). The API
 *   publishes the window's *statistical* position, not the settlement
 *   program's penalty formula or its cap — no field on `SlaWindowPosition`
 *   carries a dollar figure. Unchanged; still a dash.
 * - **"closed — INSUFFICIENT_SAMPLE, sampling raised to 100%."** The DTO's
 *   `samplingEscalationRequested` is a boolean flag that a raise was
 *   *requested*, not a record that sampling actually reached 100% — this
 *   screen says "requested", not "raised to 100%", because it cannot verify
 *   the second claim.
 * - **The slash proposal case** (the design's link target for `closed — BREACH_PROPOSED`). No
 *   dispute/strike detail route exists in this app yet, so a closed
 *   breach-proposed window states its outcome but links nowhere.
 *
 * ## "Open feed"
 *
 * The design's feed is the verdict feed screen, which is out of scope and unreachable — a
 * provider is locked out of `/verdicts` by payer-org scoping. The action
 * points at **the verdicts-and-flags screen `/provider/flags`** instead, which is this provider's own
 * call list, folded out of the CSV export. It is not window-scoped.
 *
 * ## Pause
 *
 * `pause`/`resume` answer 201 and return the whole binding; the response is
 * seeded into the detail cache with `setQueryData` rather than invalidated,
 * because provider `GET`s are HTTP-cached for 10s with an hour of
 * stale-while-revalidate and a refetch would be served the pre-write body.
 * The design draws only "Pause binding"; **"Resume binding"** is ours.
 */

const REFRESH_MS = 60_000;

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

/** One key/value pair of the Figures row, which stacks into rows on mobile. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <>
      {/* The design — desktop: a column of label over value, five across. */}
      <div className="hidden min-w-0 flex-1 flex-col gap-[3px] tablet:flex">
        {/* Not `truncate`: at 1440 the five figures share ~94px each and
            "effective threshold" is wider than that in the design too, where
            the canvas lets it bleed. Wrapping keeps the whole word. */}
        <span className="text-body-xs text-03">{label}</span>
        <span
          className={cn(
            "font-mono text-mono-md font-semibold",
            tone === "danger" ? "text-danger-600" : "text-01"
          )}
        >
          {value}
        </span>
      </div>

      {/* The design — mobile: a keyed row inside a bordered list. */}
      <div className="flex w-full items-center justify-between gap-3 py-[11px] tablet:hidden">
        <span className="text-body-sm text-02">{label}</span>
        <span
          className={cn(
            "font-mono text-mono-13 font-semibold",
            tone === "danger" ? "text-danger-600" : "text-01"
          )}
        >
          {value}
        </span>
      </div>
    </>
  );
}

/** The design's `not yet slashable` / `slashable, within SLA` / … chip. */
function statePillFor(window: SlaWindow, position: SlaWindowPosition | undefined) {
  if (window.status === "CLOSED") {
    const tone =
      window.outcome === "BREACH_PROPOSED"
        ? "danger"
        : window.outcome === "INSUFFICIENT_SAMPLE"
          ? "primary"
          : "success";
    const label = window.outcome ? `CLOSED · ${window.outcome.replace(/_/g, " ")}` : "CLOSED";
    return { label, tone: tone as "danger" | "primary" | "success" };
  }

  if (!position) return { label: "WINDOW IN FLIGHT", tone: "primary" as const };

  const standing = openWindowStanding(position);
  return { label: standing.label, tone: standing.tone };
}

const pillTone: Record<"primary" | "success" | "danger", string> = {
  primary: "bg-03 text-02",
  success: "bg-success-10 text-success-700",
  danger: "bg-danger-10 text-danger-700",
};

const gaugeTone: Record<"primary" | "success" | "danger", "primary" | "success" | "danger"> = {
  primary: "primary",
  success: "success",
  danger: "danger",
};

/** One "Recent failures" row — a reason-code group or an agent group. */
function FailureRow({ group }: { group: SlaWindowFailureGroup }) {
  return (
    <div className="flex w-full items-center gap-3 rounded-lg border border-01 bg-02 p-[13px]">
      <div className="flex w-full min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-mono-13 font-semibold text-01">{group.key}</span>
      </div>
      <span className="font-mono text-mono-sm font-semibold text-danger-600">
        {count(group.count)}
      </span>
    </div>
  );
}

export default function LiveSlaPositionPage() {
  const params = useParams<{ bindingId: string }>();
  const bindingId = params.bindingId;
  const queryClient = useQueryClient();
  const nowMs = useMinuteTick();

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const binding: ToolBindingDetail | undefined = bindingQuery.data;

  // Scoped to this binding — every window now carries a `bindingId`.
  const windowsQuery = useQuery({
    queryKey: ["provider", "sla-windows", "live", bindingId],
    queryFn: () => listSlaWindows({ bindingId, limit: 5 }),
    refetchInterval: REFRESH_MS,
    retry: 0,
  });

  const items: SlaWindow[] = windowsQuery.data?.items ?? [];
  const openWindow = items.find((w) => w.status === "OPEN") ?? null;
  const current: SlaWindow | null = openWindow ?? items[0] ?? null;

  const positionQuery = useQuery({
    queryKey: ["provider", "sla-window", current?.windowId],
    queryFn: () => getSlaWindow(current!.windowId),
    enabled: current !== null,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const position: SlaWindowPosition | undefined = positionQuery.data;

  const evidenceQuery = useQuery({
    queryKey: ["provider", "sla-window-evidence", current?.windowId],
    queryFn: () => getSlaWindowEvidence(current!.windowId),
    enabled: current !== null,
    refetchInterval: REFRESH_MS,
    retry: 0,
  });
  const evidence: SlaWindowEvidence | undefined = evidenceQuery.data;

  // ── Pause / resume ───────────────────────────────────────────────────────

  const applyWrite = (updated: ToolBindingDetail) => {
    queryClient.setQueryData(["provider", "tool-binding", bindingId], updated);
    void queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings", "sidebar"] });
  };
  const [confirmingPause, setConfirmingPause] = React.useState(false);
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
  const isPaused = binding?.status === "PAUSED";
  const busy = pause.isPending || resume.isPending;

  // ── Figures ──────────────────────────────────────────────────────────────

  const declared = binding?.slaFailureRate ?? current?.declaredFailureRate ?? null;
  const ci = position?.confidenceInterval ?? null;
  const pill = current ? statePillFor(current, position) : null;

  const stateSentence = (() => {
    if (!current) {
      return "No window has been opened yet — a window is only opened once a call is actually served.";
    }
    if (current.status === "CLOSED") {
      const escalation = current.samplingEscalationRequested
        ? " Sampling escalation was requested for this binding."
        : "";
      return `This window closed ${current.outcome ? current.outcome.replace(/_/g, " ").toLowerCase() : DASH}, at ${count(
        current.verifiedCalls
      )} verified calls of the ${count(current.minVerifiedCalls)} required.${escalation}`;
    }
    if (!position) {
      return `${count(current.verifiedCalls)} of ${count(current.minVerifiedCalls)} verified calls in this window.`;
    }
    return openWindowStanding(position).sentence;
  })();

  const windowClosed = current?.status === "CLOSED";
  // A closed window has final figures, not a projection.
  const projectionLine = windowClosed
    ? `final failure rate ${
        current!.observedFailureRate == null ? DASH : percent(current!.observedFailureRate)
      } over ${count(current!.verifiedCalls)} verified calls${
        current!.outcome ? ` · ${current!.outcome.replace(/_/g, " ").toLowerCase()}` : ""
      }`
    : position
    ? openWindowStanding(position).projection
    : `projected at close ${DASH}`;

  if (bindingQuery.isError) {
    return (
      <p className="text-body-13 text-03">
        This binding could not be loaded. It may belong to another organisation, or the id may
        not exist.
      </p>
    );
  }

  const pauseButton = (full?: boolean) =>
    isPaused ? (
      <Button
        variant={full ? "danger" : "secondary"}
        className={full ? "min-w-0 flex-1 px-3.5 py-3" : undefined}
        icon={<Play aria-hidden="true" />}
        loading={resume.isPending}
        disabled={busy || !binding}
        onClick={() => resume.mutate()}
      >
        Resume binding
      </Button>
    ) : (
      <Button
        variant={full ? "danger" : "secondary"}
        className={full ? "min-w-0 flex-1 px-3.5 py-3" : undefined}
        icon={<Pause aria-hidden="true" />}
        disabled={busy || !binding}
        onClick={() => setConfirmingPause(true)}
      >
        Pause binding
      </Button>
    );

  return (
    <>
      {/* ── Page Header — the mobile frame puts this in the top bar,
             which the console layout owns; below tablet it is a compact block. */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        {/* `w-full` as well as `flex-1`: below tablet the header is a COLUMN,
            where `flex-1` constrains height and not width, and the mono sub
            line's min-content width then pushed the page 130px wider than the
            390 viewport. Measured. */}
        <div className="flex w-full min-w-0 flex-1 flex-col gap-0.5">
          {/*
            The design has no page header: the window's identity lives in its
            Mobile Top Bar, which the console layout owns and titles "Binding".
            The layout is not this screen's to change, so the identity stays
            here and steps down a size below tablet rather than being lost.
          */}
          <h1 className="break-all text-heading-sm text-01 tablet:truncate tablet:text-heading-md">
            {current
              ? `SLA position · ${shortBindingId(bindingId)} · window ${current.label} ${
                  current.status === "OPEN" ? "in flight" : "closed"
                }`
              : `SLA position · ${shortBindingId(bindingId)}`}
          </h1>
          <p className="font-mono text-mono-12 text-03 tablet:truncate">
            {current && windowClosed
              ? `opened ${stampUtc(current.openedAt)} · closed ${
                  current.closedAt ? `${stampUtc(current.closedAt)} UTC` : DASH
                } at ${count(current.verifiedCalls)} verified calls`
              : current && nowMs !== null
              ? `opened ${stampUtc(current.openedAt)} · ${elapsed(current.openedAt, nowMs)} elapsed · closes at ${count(
                  current.minVerifiedCalls
                )} verified calls or ${stampUtc(current.deadlineAt)} UTC`
              : DASH}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-2.5 tablet:flex">
          <Button variant="secondary" asChild>
            <Link href="/provider/flags">
              <List aria-hidden="true" className="size-[15px]" />
              Open feed
            </Link>
          </Button>
          {pauseButton()}
        </div>
      </header>

      <BindingNav bindingId={bindingId} />

      {/* ── State ────────────────────────────────────── */}
      <section className="flex w-full flex-col items-start gap-2.5 rounded-lg border border-01 bg-01 p-4 tablet:flex-row tablet:items-center tablet:gap-3.5 tablet:rounded-xl tablet:px-5 tablet:py-4">
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px]",
            pill ? pillTone[pill.tone] : pillTone.primary
          )}
        >
          {pill?.label ?? "NO WINDOW"}
        </span>
        <p className="min-w-0 flex-1 text-body-sm leading-[1.55] text-01">{stateSentence}</p>
        <p className="font-mono text-mono-12 text-03">{projectionLine}</p>
      </section>

      {/* ── Row ────────────────────────────────────────────────── */}
      <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
        {/* Position. On mobile the panel chrome collapses to the
            frame's plain bordered cards, matching the design. */}
        <Panel className="w-full min-w-0 flex-1">
          <PanelHeader className="hidden tablet:flex">
            <PanelTitles>
              <PanelTitle>Position</PanelTitle>
              <PanelDescription>
                the interval overlaps the threshold — that is the visual form of a thin sample
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>

          <PanelBody className="gap-[18px] p-4 tablet:p-5">
            <WindowGauge
              label="verified calls"
              value={current?.verifiedCalls ?? 0}
              max={current?.minVerifiedCalls ?? 0}
              tone={pill ? gaugeTone[pill.tone] : "primary"}
              hint={
                position?.slashable
                  ? "this window has reached the sample gate that makes a slash proposal possible"
                  : "below this, no slash proposal can be issued at all"
              }
            />

            <div className="flex w-full flex-col tablet:flex-row tablet:gap-6">
              <Figure label="failed" value={count(current?.failedCalls ?? null)} />
              <Figure label="observed rate" value={percent(current?.observedFailureRate ?? null)} />
              <Figure label="declared" value={percent(declared)} />
              <Figure
                label="effective threshold"
                value={percent(position?.effectiveThresholdAtClose ?? null)}
                tone="danger"
              />
              <Figure
                label="99% CI"
                value={ci === null ? DASH : `${percent(ci.lower, 1)} – ${percent(ci.upper, 1)}`}
              />
            </div>

            <div className="flex w-full flex-col tablet:flex-row tablet:gap-6">
              <Figure label="error budget" value={count(position?.errorBudgetCalls ?? null)} />
              <Figure label="budget used" value={count(position?.errorBudgetUsedCalls ?? null)} />
              <Figure
                label="budget remaining"
                value={count(position?.errorBudgetRemainingCalls ?? null)}
              />
              <Figure
                label="budget used %"
                value={percent(position?.errorBudgetUsedFraction ?? null, 0)}
                tone={
                  position?.errorBudgetUsedFraction !== null &&
                  position?.errorBudgetUsedFraction !== undefined &&
                  position.errorBudgetUsedFraction > 1
                    ? "danger"
                    : undefined
                }
              />
            </div>

            <Note tone="primary" icon={<ChartSpline aria-hidden="true" className="size-[15px]" />}>
              {current && current.verifiedCalls > 0 && ci !== null
                ? `At ${count(current.verifiedCalls)} verified calls the interval around ${percent(current.observedFailureRate)} runs from ${percent(ci.lower, 1)} to ${percent(ci.upper, 1)}.${
                    position?.confidentlyAboveDeclared
                      ? " That lower bound is already above your declared rate — this is not noise."
                      : " That is why a minimum sample exists, and why a thin window cannot convict you."
                  }`
                : "Nothing in this window has been verified yet, so there is no rate to interval and nothing here could convict you."}
            </Note>
          </PanelBody>
        </Panel>

        {/* Recent failures. */}
        <Panel className="w-full tablet:w-[520px] tablet:shrink">
          <PanelHeader className="hidden tablet:flex">
            <PanelTitles>
              <PanelTitle>Recent failures</PanelTitle>
              <PanelDescription>
                {`${count(current?.failedCalls ?? null)} in this window`}
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>

          <p className="px-4 pt-4 font-mono text-mono-2xs tracking-[1.2px] text-03 tablet:hidden">
            {`RECENT FAILURES · ${count(current?.failedCalls ?? null)}`}
          </p>

          <PanelBody className="gap-4 p-4 tablet:p-5">
            {evidence && (evidence.failuresByReasonCode.length > 0 || evidence.failuresByAgentId.length > 0) ? (
              <>
                <div className="flex w-full flex-col gap-2">
                  <p className="font-mono text-mono-2xs tracking-[1.2px] text-03">BY REASON</p>
                  {evidence.failuresByReasonCode.length > 0 ? (
                    evidence.failuresByReasonCode.map((group) => (
                      <FailureRow key={`reason-${group.key}`} group={group} />
                    ))
                  ) : (
                    <p className="text-body-xs text-03">No failing call carries a reason code.</p>
                  )}
                </div>
                <div className="flex w-full flex-col gap-2">
                  <p className="font-mono text-mono-2xs tracking-[1.2px] text-03">BY AGENT</p>
                  {evidence.failuresByAgentId.length > 0 ? (
                    evidence.failuresByAgentId.map((group) => (
                      <FailureRow key={`agent-${group.key}`} group={group} />
                    ))
                  ) : (
                    <p className="text-body-xs text-03">No failing call carries an agent id.</p>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                title="No failed verdicts in this window"
                description="Failures are grouped by reason code and by agent id, straight from the window's evidence pack."
              />
            )}
          </PanelBody>
        </Panel>
      </section>

      {/* ── Sticky action — mobile only. ───────────────────────── */}
      <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2.5 border-t border-01 bg-01 px-4 pb-[22px] pt-3.5 tablet:hidden">
        <Button variant="secondary" className="min-w-0 flex-1 px-3.5 py-3" asChild>
          <Link href="/provider/flags">Open feed</Link>
        </Button>
        {pauseButton(true)}
      </div>

      {confirmingPause ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmingPause(false)}>
          <DialogContent className="max-w-[460px]">
            <DialogHeader>
              <DialogTitle>Pause binding</DialogTitle>
              <DialogDescription className="text-body-13 text-02">
                {openWindow
                  ? `Window ${openWindow.label} keeps the ${count(openWindow.verifiedCalls)} verified calls it has already accrued. No further calls accrue to it while this binding is paused. There is no routing penalty and nothing already earned changes.`
                  : "No window is accruing for this binding right now. There is no routing penalty and nothing already earned changes."}
              </DialogDescription>
            </DialogHeader>

            {pause.isError ? (
              <p className="text-body-13 text-danger-500">
                This binding could not be paused. It may already have stopped serving.
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
