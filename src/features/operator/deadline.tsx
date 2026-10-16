"use client";

import { AlertTriangle, Clock } from "lucide-react";
import * as React from "react";

import { formatDate, formatDateTime, utcTitle } from "@/libs/utc-time";
import { cn } from "@/utils";

import { disputeUrgency } from "./inbox";

/**
 * The one way the operator console shows time left: a clock icon, a relative
 * label, and colour — never colour alone, never a progress bar in a list.
 *
 *   <Deadline kind="approval" until={approval.expiresAt} from={approval.createdAt} />
 *     → [clock] 17h left · until tomorrow 05:00 UTC   neutral
 *     → [alert] 3h left · until 15:00 UTC             danger, under a quarter of the window left
 *
 *   <Deadline kind="dispute" until={row.expiresAt} from={row.disputedAt} />
 *     → [clock] 26 days left · rule by Nov 11  neutral
 *     → [alert] 7 days left · rule by Oct 23   danger, from day 20 of the 30
 *
 *   <Deadline kind="execute" until={record.executableAt} />
 *     → [clock] 30h left · cancel before Oct 18, 02:00 UTC   neutral
 *     → [alert] 5h left · cancel before 17:00 UTC           danger, under a day left
 *     → [alert] Anyone can execute it now                past
 *
 * Props:
 *   - `kind`   "approval" (a two-person request, 24 h), "dispute" (the 30-day on-chain window) or
 *              "execute" (a record anyone may execute from then: the arbiter cancels before it).
 *   - `until`  ISO instant it ends. A dispute with no `until` ends 30 days after `from`.
 *   - `from`   ISO instant it started; sets the window for the "little left" rule.
 *   - `now`    optional, for tests and for lists that share one clock. Else it ticks each minute.
 *
 * The tooltip carries the exact end, in UTC. The pure
 * `deadlineReading()` is exported for anything that needs the words without
 * the element (sorting, a table's sort key, a confirm sheet sentence).
 */

export type DeadlineKind = "approval" | "dispute" | "execute";

export interface DeadlineReading {
  /** "17h left", "7 days left · rule by Oct 23", "Expired". */
  label: string;
  /** Little left (or past): drawn danger, with the alert icon. */
  urgent: boolean;
  expired: boolean;
  /** The end instant in ms, or null when it cannot be read. */
  end: number | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "17h left", "45 min left", "3 days left", "Under a minute left". */
export function timeLeftLabel(msLeft: number): string {
  if (msLeft < MINUTE) return "Under a minute left";
  if (msLeft < HOUR) return `${Math.floor(msLeft / MINUTE)} min left`;
  if (msLeft < 2 * DAY) return `${Math.floor(msLeft / HOUR)}h left`;
  return `${Math.floor(msLeft / DAY)} days left`;
}

export function deadlineReading(
  kind: DeadlineKind,
  until: string | null | undefined,
  from?: string | null,
  now: number = Date.now(),
): DeadlineReading {
  if (kind === "dispute") {
    const urgency = disputeUrgency({ disputedAt: from ?? null, expiresAt: until ?? null }, now);
    const start = from ? Date.parse(from) : Number.NaN;
    const end = until ? Date.parse(until) : Number.isNaN(start) ? Number.NaN : start + 30 * DAY;
    if (Number.isNaN(end)) return { label: urgency.label, urgent: false, expired: false, end: null };
    // Every open dispute names its date, so two rows read alike; only the colour changes from day 20.
    const ruleBy = !urgency.expired ? ` · rule by ${formatDate(end, { now })}` : "";
    return { label: `${urgency.label}${ruleBy}`, urgent: urgency.urgent, expired: urgency.expired, end };
  }

  const end = until ? Date.parse(until) : Number.NaN;
  // The end itself, not only the time left: visible without a hover (operator review 2026-10-16b, P1-8).
  const at = Number.isNaN(end) ? "" : formatDateTime(end, { now, midSentence: true });
  if (kind === "execute") {
    if (Number.isNaN(end)) return { label: "No date set", urgent: false, expired: false, end: null };
    const msLeft = end - now;
    if (msLeft <= 0) return { label: "Anyone can execute it now", urgent: true, expired: true, end };
    return { label: `${timeLeftLabel(msLeft)} · cancel before ${at}`, urgent: msLeft < DAY, expired: false, end };
  }
  if (Number.isNaN(end)) return { label: "No expiry", urgent: false, expired: false, end: null };
  const msLeft = end - now;
  if (msLeft <= 0) return { label: "Expired", urgent: true, expired: true, end };
  const start = from ? Date.parse(from) : Number.NaN;
  const total = Number.isNaN(start) ? DAY : Math.max(1, end - start);
  return { label: `${timeLeftLabel(msLeft)} · until ${at}`, urgent: msLeft / total < 0.25, expired: false, end };
}

/**
 * The tooltip for a deadline: "Rule by Nov 11, 03:06 UTC · 2026-11-11 03:06 UTC" —
 * the end as the label reads it, then the exact UTC instant. Shared with the
 * Penalties list's Next column, so a row and its page name the same instant.
 */
export function deadlineTitle(lead: string, endIso: string): string {
  return `${lead} ${formatDateTime(endIso, { alwaysDay: true, midSentence: true })} · ${utcTitle(endIso) ?? ""}`.trim();
}

export interface DeadlineProps {
  kind: DeadlineKind;
  until: string | null | undefined;
  from?: string | null;
  now?: number;
  className?: string;
}

export function Deadline({ kind, until, from, now: fixedNow, className }: DeadlineProps) {
  // Relative time depends on the reader's clock: the static export prints the
  // end date, and the live label lands after mount (no hydration mismatch).
  const [mounted, setMounted] = React.useState(false);
  const [tick, setTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    setMounted(true);
    if (fixedNow !== undefined) return;
    const timer = setInterval(() => setTick(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, [fixedNow]);

  const reading = deadlineReading(kind, until, from, fixedNow ?? tick);
  const endIso = reading.end === null ? undefined : new Date(reading.end).toISOString();
  // A dispute names what is due by then: the date is in the label, the exact instant one hover away.
  const title = endIso ? deadlineTitle(kind === "dispute" ? "Rule by" : kind === "execute" ? "Cancel before" : "Ends", endIso) : undefined;
  const Icon = reading.urgent ? AlertTriangle : Clock;
  const label = mounted ? reading.label : endIso ? `Ends ${utcTitle(endIso)}` : reading.label;

  return (
    <span
      data-deadline={kind}
      data-urgent={reading.urgent ? "" : undefined}
      title={mounted ? title : undefined}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-body-xs tabular-nums",
        reading.urgent ? "text-danger-600" : "text-02",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {endIso ? <time dateTime={endIso}>{label}</time> : label}
    </span>
  );
}
