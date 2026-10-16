"use client";

import * as React from "react";

import { formatDate, formatDateTime, formatRelative, utcTitle } from "@/libs/utc-time";
import { cn } from "@/utils";

/**
 * A server timestamp, shown in UTC and labelled, with the exact UTC instant in
 * the tooltip and in `dateTime`.
 *
 *   <UtcTime value={call.createdAt} />              // "14:20 UTC" / "Oct 16, 14:20 UTC"
 *   <UtcTime value={x.expiresAt} dateOnly />         // "Oct 16"
 *   asked <UtcTime value={a.createdAt} midSentence /> // "asked yesterday 14:20 UTC"
 *
 * The first render prints the exact instant and the day-relative form lands
 * after mount: "Today" depends on the reader's clock, and the static export was
 * rendered at another moment, so printing it first would be a hydration mismatch.
 */
export interface UtcTimeProps extends React.TimeHTMLAttributes<HTMLTimeElement> {
  value: string | number | Date | null | undefined;
  dateOnly?: boolean;
  /** "4 min ago" within the hour, "Today 14:20 UTC" later today — for live lists. */
  relative?: boolean;
  /** The time sits inside a sentence: "asked yesterday 14:20 UTC", not "asked Yesterday 14:20 UTC". */
  midSentence?: boolean;
  /** Name the day even when it is today ("Today 14:20 UTC"), as the receipt timeline and debt banner do. */
  alwaysDay?: boolean;
}

export function UtcTime({
  value,
  dateOnly = false,
  relative = false,
  midSentence = false,
  alwaysDay = false,
  className,
  ...props
}: UtcTimeProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const date = value === null || value === undefined || value === "" ? null : new Date(value);
  const iso = date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
  const options = { midSentence, alwaysDay };
  const text = !mounted
    ? (utcTitle(value) ?? "—")
    : dateOnly
      ? formatDate(value)
      : relative
        ? formatRelative(value, { midSentence })
        : formatDateTime(value, options);

  return (
    <time dateTime={iso} title={utcTitle(value)} className={cn("tabular-nums", className)} {...props}>
      {text}
    </time>
  );
}
