"use client";

import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * A short linear flow's progress: "1 You · 2 Get paid · 3 Your API". For a
 * flow done in one sitting on one page (setup, the listing wizard); a goal
 * spread over days is a `SetupChecklist` instead.
 *
 *   <Stepper
 *     steps={[
 *       { id: "you", label: "You", state: "done" },
 *       { id: "paid", label: "Get paid", state: "current" },
 *       { id: "api", label: "Your API", state: "upcoming" },
 *     ]}
 *     onSelect={(id) => setStage(id)}   // done steps become buttons
 *     sticky
 *   />
 *
 * The caller decides each state from data; a done step can be revisited, an
 * upcoming one cannot be jumped to. A thin bar under the labels shows how far
 * along the flow is. At 390px the labels stay (short words), the numbers shrink.
 */
export type StepperState = "done" | "current" | "upcoming";

export interface StepperStep {
  id: string;
  label: string;
  state: StepperState;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Makes done steps (and the current one) clickable. */
  onSelect?: (id: string) => void;
  /** Stick to the top of the scroll container. */
  sticky?: boolean;
  className?: string;
  /** For screen readers. Default "Progress". */
  label?: string;
}

/** 0–100: done steps count fully, the current one half. */
export function stepperPercent(steps: readonly Pick<StepperStep, "state">[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((step) => step.state === "done").length;
  const current = steps.some((step) => step.state === "current") ? 0.5 : 0;
  return Math.round(((done + current) / steps.length) * 100);
}

export function Stepper({ steps, onSelect, sticky = false, className, label = "Progress" }: StepperProps) {
  const percent = stepperPercent(steps);
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex w-full flex-col gap-2.5 rounded-lg border border-01 bg-01 px-3 py-2.5 tablet:px-4",
        sticky && "sticky top-[60px] z-20 tablet:top-0",
        className,
      )}
    >
      <ol className="flex w-full items-center gap-1.5 tablet:gap-3">
        {steps.map((step, index) => {
          const clickable = Boolean(onSelect) && step.state !== "upcoming";
          const content = (
            <>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-mono-xs font-semibold tablet:size-6",
                  step.state === "done" && "bg-success-500 text-on-color",
                  step.state === "current" && "bg-primary-400 text-on-primary",
                  step.state === "upcoming" && "border border-02 bg-01 text-03",
                )}
              >
                {step.state === "done" ? <Check aria-hidden="true" strokeWidth={3} className="size-3" /> : index + 1}
              </span>
              <span
                className={cn(
                  "truncate text-label-13",
                  step.state === "current" ? "text-01" : step.state === "done" ? "text-02" : "text-03",
                )}
              >
                {step.label}
              </span>
              <span className="sr-only">
                , {step.state === "done" ? "done" : step.state === "current" ? "current step" : "not started"}
              </span>
            </>
          );
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1.5 tablet:gap-3">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelect?.(step.id)}
                  aria-current={step.state === "current" ? "step" : undefined}
                  className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:gap-2"
                >
                  {content}
                </button>
              ) : (
                <span
                  aria-current={step.state === "current" ? "step" : undefined}
                  className="flex min-w-0 items-center gap-1.5 py-0.5 tablet:gap-2"
                >
                  {content}
                </span>
              )}
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="hidden h-px min-w-3 flex-1 bg-03 tablet:block" />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${percent}% done`}
        className="h-1 w-full overflow-hidden rounded-full bg-03"
      >
        <span
          className="block h-full rounded-full bg-primary-400 transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </nav>
  );
}
