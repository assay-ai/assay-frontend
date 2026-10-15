"use client";

import { AlertTriangle, Clock } from "lucide-react";
import * as React from "react";

import { disputeUrgency } from "@/features/operator/inbox";
import { formatLocalDate, formatLocalDateTime, utcTitle } from "@/libs/local-time";
import { cn } from "@/utils";

/**
 * TEMPORARY — Package C's stand-in for Package A's `features/operator/deadline.tsx`
 * (OPERATOR-redesign §C4), with the same props. Replace the imports with A's
 * component once it is merged, and delete this file.
 *
 *   <Deadline until={row.expiresAt} from={row.disputedAt} kind="dispute" now={now} />
 *     → [clock] 26 days left                      neutral
 *     → [!] 7 days left · rule by Oct 23           danger, from day 20
 *   <Deadline until={approval.expiresAt} from={approval.createdAt} kind="approval" now={now} />
 *     → [clock] 17h left                          danger under 25% left
 *
 * Icon, words and colour together; the full local time and UTC in the tooltip.
 */
export function Deadline({
  until,
  from,
  kind,
  now,
  className,
}: {
  until: string | null | undefined;
  from?: string | null;
  kind: "approval" | "dispute";
  /** The page's clock (it ticks once a minute), so every row agrees. */
  now: number;
  className?: string;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const end = until ? Date.parse(until) : Number.NaN;

  let text: string;
  let urgent = false;
  if (kind === "dispute") {
    const urgency = disputeUrgency({ disputedAt: from ?? null, expiresAt: until ?? null }, now);
    urgent = urgency.urgent;
    text = urgency.label;
    if (!urgency.expired && urgency.daysLeft !== null && urgency.daysLeft < 10 && mounted && !Number.isNaN(end)) {
      text = `${urgency.label} · rule by ${formatLocalDate(end)}`;
    }
  } else if (Number.isNaN(end)) {
    text = "No deadline";
  } else {
    const left = end - now;
    const start = from ? Date.parse(from) : Number.NaN;
    const total = Number.isNaN(start) ? 24 * 3_600_000 : Math.max(1, end - start);
    urgent = left <= total * 0.25;
    const hours = Math.floor(left / 3_600_000);
    text = left <= 0 ? "Expired" : hours >= 1 ? `${hours}h left` : `${Math.max(1, Math.floor(left / 60_000))} min left`;
  }

  const Icon = urgent ? AlertTriangle : Clock;
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap text-body-xs tabular-nums", urgent ? "text-danger-600" : "text-02", className)}
      title={until ? `${mounted ? formatLocalDateTime(until) : ""} · ${utcTitle(until) ?? ""}`.replace(/^ · /, "") : undefined}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {text}
    </span>
  );
}
