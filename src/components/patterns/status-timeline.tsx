"use client";

import { Check, Minus, X } from "lucide-react";
import * as React from "react";

import { formatRemaining, useCountdown } from "@/hooks/useCountdown";
import { formatLocalDateTime, utcTitle } from "@/libs/local-time";
import { cn } from "@/utils";

/**
 * A lifecycle as a stepper: binding (Draft → Tested → Live), penalty
 * (Proposed → Disputed → Ruled → Executed), withdrawal (Requested → Waiting →
 * Claimable), unstake (Unbonding → Withdrawable).
 *
 *   <StatusTimeline steps={[
 *     { id: "proposed", label: "Proposed", state: "done", date: p.createdAt },
 *     { id: "dispute", label: "Dispute window", state: "current", date: p.disputeUntil, countdown: true },
 *     { id: "executed", label: "Executed", state: "upcoming", date: p.executableAt },
 *   ]} />
 *
 * Horizontal from `tablet` up, stacked below it. The **next date** — the
 * first not-yet-finished step with a date — is highlighted, because "when
 * does something happen next" is the question every lifecycle screen is
 * asked. Dates render in local time with the UTC instant in the tooltip.
 */

export type TimelineStepState = "done" | "current" | "upcoming" | "skipped" | "failed";

export interface StatusTimelineStep {
  id: string;
  label: React.ReactNode;
  state: TimelineStepState;
  /** ISO instant. Rendered in local time. */
  date?: string | null;
  /** Free text instead of (or with no) date, e.g. "after the window closes". */
  dateLabel?: React.ReactNode;
  /** Show a live "in 3d 4h" countdown to `date`. */
  countdown?: boolean;
  /** One short sentence under the label. */
  description?: React.ReactNode;
  /** Draw the date as urgent (danger), e.g. a dispute deadline under 10 days away. Decided by the caller. */
  urgent?: boolean;
}

export interface StatusTimelineProps {
  steps: StatusTimelineStep[];
  /** Called once when a counting-down date passes, e.g. to refetch the record. */
  onElapsed?: (stepId: string) => void;
  /** Accessible name of the list. Default "Status". */
  label?: string;
  /** Force one orientation. Default: vertical on mobile, horizontal from tablet. */
  orientation?: "auto" | "horizontal" | "vertical";
  /** Every date carries its day ("Today 18:41", never a bare "18:41"). */
  alwaysDay?: boolean;
  className?: string;
}

/**
 * The step whose date is next: the first step not yet finished (current or
 * upcoming) that has a date. Pure, so it is tested without rendering.
 */
export function nextDatedStepIndex(steps: readonly Pick<StatusTimelineStep, "state" | "date">[]): number {
  return steps.findIndex(
    (step) => (step.state === "current" || step.state === "upcoming") && Boolean(step.date) && !Number.isNaN(Date.parse(step.date!)),
  );
}

const STATE_WORD: Record<TimelineStepState, string> = {
  done: "done",
  current: "in progress",
  upcoming: "not yet",
  skipped: "skipped",
  failed: "failed",
};

function Mark({ state, index }: { state: TimelineStepState; index: number }) {
  const base = "relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full";
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "bg-success-500 text-on-color")}>
          <Check aria-hidden="true" strokeWidth={3} className="size-3.5" />
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "bg-danger-500 text-on-color")}>
          <X aria-hidden="true" strokeWidth={3} className="size-3.5" />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "border border-02 bg-02 text-03")}>
          <Minus aria-hidden="true" className="size-3.5" />
        </span>
      );
    case "current":
      return (
        <span className={cn(base, "bg-primary-400 text-label-xs tabular-nums text-on-primary ring-4 ring-primary-10")}>
          {index + 1}
        </span>
      );
    default:
      return <span className={cn(base, "border border-02 bg-01 text-label-xs tabular-nums text-03")}>{index + 1}</span>;
  }
}

function StepDate({
  step,
  highlighted,
  onElapsed,
  alwaysDay,
}: {
  step: StatusTimelineStep;
  highlighted: boolean;
  onElapsed?: (stepId: string) => void;
  alwaysDay?: boolean;
}) {
  const { msLeft, hasPassed } = useCountdown(step.countdown ? step.date : null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (step.countdown && hasPassed && !fired.current) {
      fired.current = true;
      onElapsed?.(step.id);
    }
  }, [hasPassed, onElapsed, step.countdown, step.id]);
  if (!step.date && !step.dateLabel) return null;

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1 text-body-xs tabular-nums",
        highlighted
          ? cn(
              "self-start rounded-sm px-1.5 py-px",
              step.urgent ? "bg-danger-10 text-danger-700" : "bg-primary-10 text-primary-700",
            )
          : step.urgent
            ? "text-danger-600"
            : "text-03",
      )}
    >
      {/* The label leads ("Dispute by Oct 18, 04:44"): a date on its own does not say what happens then. */}
      {step.dateLabel ? <span>{step.dateLabel}</span> : null}
      {step.date ? (
        <time dateTime={step.date} title={utcTitle(step.date)} className="whitespace-nowrap">
          {/* After a lead-in ("sign before today 19:06") the day word is mid-sentence; alone it starts the line ("Today 10:06"). */}
          {mounted ? formatLocalDateTime(step.date, { alwaysDay, midSentence: Boolean(step.dateLabel) }) : utcTitle(step.date)}
        </time>
      ) : null}
      {step.countdown && msLeft !== null ? (
        <span className={cn("whitespace-nowrap", highlighted && "font-semibold")}>
          {/* Never "now": under a minute reads "in under a minute" (useCountdown), so nobody acts before the chain ticks over. */}
          · {hasPassed ? "time is up" : `in ${formatRemaining(msLeft)}`}
        </span>
      ) : null}
    </span>
  );
}

export function StatusTimeline({ steps, label = "Status", orientation = "auto", onElapsed, alwaysDay, className }: StatusTimelineProps) {
  const next = nextDatedStepIndex(steps);
  const horizontal = orientation === "horizontal";
  const vertical = orientation === "vertical";

  return (
    <ol
      aria-label={label}
      className={cn(
        "flex w-full",
        horizontal ? "flex-row" : vertical ? "flex-col" : "flex-col tablet:flex-row",
        className,
      )}
    >
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const connectorDone = step.state === "done" || step.state === "skipped";
        return (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "relative flex min-w-0 gap-3",
              horizontal ? "flex-1 flex-col pr-3" : vertical ? "pb-5 last:pb-0" : "pb-5 last:pb-0 tablet:flex-1 tablet:flex-col tablet:pb-0 tablet:pr-3",
            )}
          >
            {/* The connector to the next step: vertical line on mobile, horizontal from tablet. */}
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute",
                  connectorDone ? "bg-success-500" : "bg-04",
                  horizontal
                    ? "left-7 right-1 top-3 h-0.5"
                    : vertical
                      ? "bottom-1 left-3 top-7 w-0.5 -translate-x-1/2"
                      : "bottom-1 left-3 top-7 w-0.5 -translate-x-1/2 tablet:bottom-auto tablet:left-7 tablet:right-1 tablet:top-3 tablet:h-0.5 tablet:w-auto tablet:translate-x-0",
                )}
              />
            ) : null}
            <Mark state={step.state} index={index} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  "text-label-13",
                  step.state === "upcoming" || step.state === "skipped" ? "text-02" : "text-01",
                  step.state === "failed" && "text-danger-600",
                )}
              >
                {step.label}
                <span className="sr-only">, {STATE_WORD[step.state]}</span>
              </span>
              <StepDate step={step} highlighted={index === next} onElapsed={onElapsed} alwaysDay={alwaysDay} />
              {step.description ? <span className="text-body-xs text-03">{step.description}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
