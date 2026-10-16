"use client";

import { Check, ChevronDown, Lock, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

import { Skeleton } from "./page-state";

/**
 * A goal broken into ordered steps that tick themselves from data.
 *
 *   <SetupChecklist
 *     title="Get started"
 *     steps={[
 *       { id: "wallet", title: "Link a wallet", state: "done" },
 *       { id: "agent", title: "Create an agent", state: "current",
 *         description: "An agent is what calls tools for you.",
 *         content: <CreateAgentForm /> },
 *       { id: "connect", title: "Connect it to your MCP client", state: "todo" },
 *       { id: "call", title: "Make a first call", state: "blocked",
 *         blockedReason: "Needs an agent first." },
 *     ]}
 *   />
 *
 * The caller derives every `state` from real data (API, chain); this
 * component only draws it. It never marks a step done on a click.
 *
 * - The first `current` step opens by default; a step with `content` expands
 *   inline, so the action happens here rather than on another page.
 * - When every step is done (optional steps aside) the list collapses to one
 *   "All set" line, with "Show steps" to look back.
 * - `onDismiss` adds a close button; leave it out when the checklist must stay.
 */

export type SetupStepState = "done" | "current" | "todo" | "blocked";

export interface SetupStep {
  id: string;
  title: React.ReactNode;
  /** One sentence under the title. */
  description?: React.ReactNode;
  state: SetupStepState;
  /** Why the step cannot start yet. Shown under the title when `blocked`. */
  blockedReason?: React.ReactNode;
  /** The step's own action UI, shown when the step is expanded. */
  content?: React.ReactNode;
  /** Shown as "Optional"; does not count towards "all set". */
  optional?: boolean;
}

export interface SetupChecklistProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  steps: SetupStep[];
  /** Controlled expanded step. Leave out to let the checklist manage it. */
  expandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
  /** Shown instead of the list when everything is done. Default "All set". */
  doneTitle?: React.ReactNode;
  doneDescription?: React.ReactNode;
  /** Adds a dismiss button. */
  onDismiss?: () => void;
  /**
   * True while the data the steps are derived from is still loading: shows a
   * skeleton instead of a misleading "0 of 4" or "All set".
   */
  loading?: boolean;
  className?: string;
}

/** Counts and the "all set" rule, pure so it can be tested. */
export function checklistProgress(steps: readonly Pick<SetupStep, "state" | "optional">[]): {
  done: number;
  total: number;
  complete: boolean;
} {
  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.state === "done").length;
  return { done, total: required.length, complete: required.length > 0 && done === required.length };
}

/** The step to open first: the first `current`, else the first not done and not blocked. */
export function defaultExpandedStep(steps: readonly SetupStep[]): string | null {
  const current = steps.find((step) => step.state === "current");
  if (current) return current.content ? current.id : null;
  const next = steps.find((step) => step.state === "todo" && step.content);
  return next ? next.id : null;
}

/** The numbered (or ticked / locked) circle of a step, for other ordered step lists too. */
export function StepMark({ state, index }: { state: SetupStepState; index: number }) {
  if (state === "done") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-500 text-on-color">
        <Check aria-hidden="true" strokeWidth={3} className="size-3.5" />
      </span>
    );
  }
  if (state === "blocked") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-02 bg-02 text-03">
        <Lock aria-hidden="true" className="size-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-mono-12 font-semibold",
        state === "current" ? "bg-primary-400 text-on-primary" : "border border-02 bg-01 text-03",
      )}
    >
      {index + 1}
    </span>
  );
}

const STATE_WORD: Record<SetupStepState, string> = {
  done: "done",
  current: "next",
  todo: "to do",
  blocked: "waiting",
};

export function SetupChecklist({
  title,
  description,
  steps,
  expandedId,
  onExpandedChange,
  doneTitle = "All set",
  doneDescription,
  onDismiss,
  loading = false,
  className,
}: SetupChecklistProps) {
  const baseId = React.useId();
  const progress = checklistProgress(steps);
  const [internalExpanded, setInternalExpanded] = React.useState<string | null>(() => defaultExpandedStep(steps));
  const expanded = expandedId !== undefined ? expandedId : internalExpanded;
  const setExpanded = (id: string | null) => {
    if (expandedId === undefined) setInternalExpanded(id);
    onExpandedChange?.(id);
  };
  const [showWhenDone, setShowWhenDone] = React.useState(false);

  // When the data moves the current step on, follow it — unless the person
  // has opened another step themselves.
  // Keyed on whether the current step has its content yet too: on load the
  // current step is known before its content (the data behind it is still
  // being read), and it must still open once the content arrives.
  const currentStep = steps.find((step) => step.state === "current");
  const currentId = currentStep ? `${currentStep.id}:${currentStep.content ? "ready" : "empty"}` : null;
  const lastCurrent = React.useRef(currentId);
  React.useEffect(() => {
    if (lastCurrent.current === currentId) return;
    lastCurrent.current = currentId;
    if (expandedId === undefined) setInternalExpanded(defaultExpandedStep(steps));
  }, [currentId, expandedId, steps]);

  const dismiss = onDismiss ? (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss checklist"
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-03 transition-colors hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <X aria-hidden="true" className="size-4" />
    </button>
  ) : null;

  if (loading) {
    return (
      <section
        aria-busy="true"
        aria-label={typeof title === "string" ? title : "Checklist"}
        className={cn("flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-soft tablet:p-5", className)}
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-1.5 w-[160px] rounded-full" />
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-3 pt-1">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </section>
    );
  }

  if (progress.complete && !showWhenDone) {
    return (
      <section
        aria-label={typeof title === "string" ? title : undefined}
        className={cn("flex w-full items-center gap-3 rounded-xl border border-01 bg-01 px-4 py-3 shadow-hair", className)}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-500 text-on-color">
          <Check aria-hidden="true" strokeWidth={3} className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-label-13 text-01">{doneTitle}</span>
          {doneDescription ? <span className="text-body-xs text-03">{doneDescription}</span> : null}
        </div>
        <button
          type="button"
          onClick={() => setShowWhenDone(true)}
          className="shrink-0 rounded-md px-2 py-1 text-label-13 text-02 hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          Show steps
        </button>
        {dismiss}
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className={cn("flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01 shadow-soft", className)}
    >
      <header className="flex w-full items-start gap-3 border-b border-01 px-4 py-4 tablet:px-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={`${baseId}-title`} className="text-label-md text-01">
            {title}
          </h2>
          {description ? <p className="text-body-13 text-02">{description}</p> : null}
          <div className="mt-1.5 flex items-center gap-2.5">
            <div
              role="progressbar"
              aria-label="Steps done"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-03"
            >
              <div
                className="h-full rounded-full bg-success-500 transition-[width] duration-500"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-mono-12 text-03">
              {progress.done} of {progress.total}
            </span>
          </div>
        </div>
        {progress.complete ? (
          <button
            type="button"
            onClick={() => setShowWhenDone(false)}
            className="shrink-0 rounded-md px-2 py-1 text-label-13 text-02 hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            Hide steps
          </button>
        ) : null}
        {dismiss}
      </header>

      <ol className="flex w-full flex-col">
        {steps.map((step, index) => {
          const open = expanded === step.id && Boolean(step.content);
          const expandable = Boolean(step.content) && step.state !== "blocked";
          const panelId = `${baseId}-${step.id}`;
          const row = (
            <>
              <StepMark state={step.state} index={index} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                <span
                  className={cn(
                    "flex flex-wrap items-center gap-x-2 text-label-sm",
                    step.state === "done" ? "text-02" : step.state === "blocked" ? "text-03" : "text-01",
                  )}
                >
                  {step.title}
                  {step.optional ? (
                    <span className="rounded-full bg-03 px-1.5 py-px text-label-xs text-03">Optional</span>
                  ) : null}
                </span>
                {step.state === "blocked" && step.blockedReason ? (
                  <span className="text-body-xs text-03">{step.blockedReason}</span>
                ) : step.description && step.state !== "done" ? (
                  <span className="text-body-xs text-03">{step.description}</span>
                ) : null}
              </span>
              <span className="sr-only">, {STATE_WORD[step.state]}</span>
              {expandable ? (
                <ChevronDown
                  aria-hidden="true"
                  className={cn("mt-0.5 size-4 shrink-0 text-03 transition-transform", open && "rotate-180")}
                />
              ) : null}
            </>
          );

          return (
            <li
              key={step.id}
              className={cn("border-b border-01 last:border-b-0", step.state === "current" && "bg-primary-5")}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {expandable ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setExpanded(open ? null : step.id)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 transition-colors hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                >
                  {row}
                </button>
              ) : (
                <div className="flex w-full items-start gap-3 px-4 py-3.5 tablet:px-5">{row}</div>
              )}
              {open ? (
                <div id={panelId} className="px-4 pb-4 pl-[52px] tablet:px-5 tablet:pl-[56px]">
                  {step.content}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The checklist's progress as a compact pill for a header or sidebar ("Get
 * listed · 2 of 5"), linking to where the full checklist lives. Hidden once
 * every required step is done.
 *
 *   <ChecklistPill label="Get listed" steps={steps} href="/provider" />
 */
export function ChecklistPill({
  label,
  steps,
  href,
  linkAs: LinkComponent = "a",
  className,
}: {
  label: string;
  steps: readonly Pick<SetupStep, "state" | "optional">[];
  href: string;
  linkAs?: React.ElementType;
  className?: string;
}) {
  const progress = checklistProgress(steps);
  if (progress.complete || progress.total === 0) return null;
  return (
    <LinkComponent
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-primary-20 bg-primary-10 py-1 pl-1 pr-2.5 text-label-xs text-primary-700",
        "transition-colors hover:bg-primary-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        className,
      )}
    >
      <span className="rounded-full bg-primary-400 px-1.5 py-px font-mono text-mono-xs font-semibold text-on-primary">
        {progress.done}/{progress.total}
      </span>
      {label}
      <span className="sr-only">
        : {progress.done} of {progress.total} steps done
      </span>
    </LinkComponent>
  );
}
