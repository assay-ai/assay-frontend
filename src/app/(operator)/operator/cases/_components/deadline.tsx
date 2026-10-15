"use client";

import { AlertTriangle, Clock } from "lucide-react";
import * as React from "react";

import { durationLeft } from "@/features/operator/penalty-list";
import { formatLocalDate, formatLocalDateTime, utcTitle } from "@/libs/local-time";
import { cn } from "@/utils";

/**
 * TEMPORARY — replace with `@/features/operator/deadline` once Package A of
 * the operator redesign is merged; same props (spec C4), so the swap is an
 * import change. Kept local so the Penalties pages show time one way today.
 *
 *   <Deadline until={iso} from={iso} kind="dispute" />   → 🕒 26 days left
 *                                                         → ⚠ 7 days left · rule by Oct 23   (from day 20)
 *   <Deadline until={iso} kind="approval" />             → 🕒 17h left  (danger under 25% left)
 *
 * Icon plus text plus colour, never colour alone; the full local time and UTC
 * are in the tooltip.
 */

const DISPUTE_DAYS = 30;
const DISPUTE_RED_FROM_DAY = 20;
const DAY_MS = 86_400_000;
const APPROVAL_MS = 24 * 3_600_000;

export interface DeadlineProps {
  until: string;
  from?: string | null;
  kind: "approval" | "dispute";
  className?: string;
}

function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function Deadline({ until, from = null, kind, className }: DeadlineProps) {
  const now = useMinuteClock();
  const end = Date.parse(until);
  if (Number.isNaN(end)) return null;
  const left = end - now;
  const start = from ? Date.parse(from) : Number.NaN;

  let text: string;
  let danger: boolean;
  if (left <= 0) {
    text = kind === "dispute" ? "Time is up" : "Expired";
    danger = true;
  } else if (kind === "dispute") {
    const daysLeft = Math.ceil(left / DAY_MS);
    // Day N of 30 counts from the dispute; without it, the days left decide.
    const day = Number.isNaN(start) ? DISPUTE_DAYS - daysLeft : Math.floor((now - start) / DAY_MS);
    danger = day >= DISPUTE_RED_FROM_DAY;
    const days = daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
    text = danger ? `${days} · rule by ${formatLocalDate(until, { now })}` : days;
  } else {
    const total = Number.isNaN(start) ? APPROVAL_MS : end - start;
    danger = left < total * 0.25;
    text = `${durationLeft(left)} left`;
  }

  const Icon = danger ? AlertTriangle : Clock;
  return (
    <span
      title={`${formatLocalDateTime(until)} · ${utcTitle(until) ?? ""}`}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap text-body-xs tabular-nums", danger ? "text-danger-600" : "text-02", className)}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {text}
    </span>
  );
}
