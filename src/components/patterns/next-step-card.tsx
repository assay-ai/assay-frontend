"use client";

import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

/**
 * The one thing this person can do next on a record, or why there is nothing.
 *
 *   <NextStepCard
 *     kind="action"
 *     title="Suspend this penalty"
 *     description="Cancels the penalty before it executes. Only you can do this now."
 *     meta="Executable in 2d 4h"
 *     action={{ label: "Suspend penalty", onClick: openSheet, tone: "danger" }}
 *   />
 *
 *   <NextStepCard
 *     kind="waiting"
 *     title="Nothing for you"
 *     description="Waiting for the provider's dispute window to close on 18 Oct, 14:00."
 *   />
 *
 * Rules it enforces:
 *  - at most ONE primary action (plus an optional quiet secondary one);
 *  - "waiting" always says who or what it waits for, and until when — the
 *    caller writes that sentence, the card only frames it;
 *  - "done" is for a closed record: what happened, no button.
 *
 * Decide the step in a pure function (from roles and state) and render it
 * here, so the rule can be tested without the screen.
 */
export interface NextStepAction {
  label: string;
  /** A link ("go somewhere"). One of `href` / `onClick`. */
  href?: string;
  /** A handler ("do something here"). */
  onClick?: () => void;
  tone?: "primary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}

export interface NextStepCardProps {
  kind: "action" | "waiting" | "done";
  /** Short: "Rule on this dispute", "Nothing for you", "Penalty executed". */
  title: React.ReactNode;
  /** One or two sentences: what the action does, or what is being waited for and until when. */
  description?: React.ReactNode;
  /** A short line under the description, e.g. "needs a second Lead adjudicator". Not the deadline again. */
  meta?: React.ReactNode;
  action?: NextStepAction;
  /** A quiet second action, e.g. "Block this provider". */
  secondary?: NextStepAction;
  /** Small label above the title. None by default: the title is the information. */
  eyebrow?: React.ReactNode;
  /** One line under the body, e.g. a one-line "why you can't · ask" for a read-only role. */
  footer?: React.ReactNode;
  /** "stack" keeps text over buttons at every width, for a narrow side column; from 640px the buttons are auto width, right-aligned. */
  layout?: "row" | "stack";
  className?: string;
}

function ActionButton({ action, variant, full }: { action: NextStepAction; variant: "primary" | "danger" | "secondary"; full: boolean }) {
  // "touch-target": 40px tall on touch widths. Stacked, the buttons are full width on a phone, auto width from 640px.
  const width = full ? "touch-target w-full sm:w-auto" : "touch-target w-full tablet:w-auto";
  if (action.href && !action.disabled) {
    return (
      <Button variant={variant} asChild className={width}>
        <Link href={action.href}>
          {action.label}
          {variant !== "secondary" ? <ArrowRight aria-hidden="true" /> : null}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant={variant}
      onClick={action.onClick}
      disabled={action.disabled}
      loading={action.loading}
      className={width}
    >
      {action.label}
    </Button>
  );
}

export function NextStepCard({ kind, title, description, meta, action, secondary, eyebrow, footer, layout = "row", className }: NextStepCardProps) {
  const Icon = kind === "action" ? ArrowRight : kind === "waiting" ? Clock : CheckCircle2;
  const stack = layout === "stack";
  return (
    <section
      aria-label={typeof title === "string" ? `Next step: ${title}` : "Next step"}
      className={cn(
        "flex w-full flex-col gap-3 rounded-xl border p-4",
        !stack && "tablet:flex-row tablet:items-center tablet:gap-5 tablet:p-5",
        kind === "action" ? "border-primary-20 bg-primary-10" : kind === "done" ? "border-01 bg-02" : "border-01 bg-01",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            kind === "action" ? "bg-primary-400 text-on-primary" : kind === "done" ? "bg-success-10 text-success-600" : "bg-03 text-02",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? <p className="text-label-xs text-03">{eyebrow}</p> : null}
          <p className="text-label-md text-01">{title}</p>
          {description ? <p className="text-body-13 text-02">{description}</p> : null}
          {meta ? <p className="text-body-xs tabular-nums text-03">{meta}</p> : null}
          {footer ? <div className="pt-1">{footer}</div> : null}
        </div>
      </div>
      {action || secondary ? (
        <div
          className={cn(
            "flex w-full shrink-0 flex-col gap-2",
            stack ? "sm:flex-row sm:flex-wrap sm:justify-end" : "tablet:w-auto tablet:flex-row tablet:items-center",
          )}
        >
          {secondary ? <ActionButton action={secondary} variant="secondary" full={stack} /> : null}
          {action ? <ActionButton action={action} variant={action.tone === "danger" ? "danger" : "primary"} full={stack} /> : null}
        </div>
      ) : null}
    </section>
  );
}
