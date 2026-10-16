import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Semantic dot colour per event. "neutral" covers ordinary lifecycle points
 * (created, response returned); the accent tones mark the events the design
 * calls out (funds held = primary, refunded = teal, settled = success).
 */
const dotVariants = cva("h-2 w-2 shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-text-03",
      primary: "bg-primary-500",
      success: "bg-success-500",
      teal: "bg-teal-500",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

export type TimelineEventTone = NonNullable<VariantProps<typeof dotVariants>["tone"]>;

export interface TimelineEvent {
  id?: string;
  /** Timestamp as shown, e.g. "10:00:04" in the reader's own time zone. */
  time: string;
  /** Tooltip for the timestamp — the exact UTC instant. */
  timeTitle?: string;
  label: string;
  /** Monospace detail, e.g. "$0.01" or "408ms". Omit for events with nothing to report. */
  meta?: string;
  tone?: TimelineEventTone;
}

export interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  events: TimelineEvent[];
}

/** A vertical, chronological list of call-lifecycle events. */
export const Timeline = React.forwardRef<HTMLOListElement, TimelineProps>(
  ({ events, className, ...props }, ref) => (
    <ol ref={ref} className={cn("flex w-full flex-col", className)} {...props}>
      {events.map((event, index) => (
        <li
          key={event.id ?? `${event.label}-${index}`}
          // On a phone the meta wraps under the label: a stamp carries its day ("Sep 15, 02:11:30").
          className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-1 py-2.5 tablet:flex-nowrap"
        >
          <span className="sr-only">
            {event.time} — {event.label}
            {event.meta ? `: ${event.meta}` : ""}
          </span>
          <span aria-hidden="true" title={event.timeTitle} className="shrink-0 text-mono-12 font-mono tabular-nums text-03">
            {event.time}
          </span>
          <span aria-hidden="true" className={dotVariants({ tone: event.tone })} />
          <span aria-hidden="true" className="min-w-0 flex-1 text-label-sm text-01 tablet:w-[180px] tablet:flex-none tablet:shrink-0">
            {event.label}
          </span>
          {event.meta ? (
            <span aria-hidden="true" className="min-w-0 basis-full text-mono-12 font-mono text-02 tablet:basis-auto tablet:flex-1">
              {event.meta}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
);
Timeline.displayName = "Timeline";
