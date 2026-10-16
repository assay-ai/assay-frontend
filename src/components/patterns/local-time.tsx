"use client";

import * as React from "react";

import { formatLocalDate, formatLocalDateTime, formatRelative, formatUtcDateTime, utcTitle, zoneLabel } from "@/libs/local-time";
import { cn } from "@/utils";

/**
 * A server timestamp, shown in the reader's own time zone, with the exact UTC
 * instant in the tooltip and in `dateTime`.
 *
 *   <LocalTime value={call.createdAt} />            // "14:20" / "Oct 16, 14:20"
 *   <LocalTime value={x.expiresAt} dateOnly />       // "Oct 16"
 *   asked <LocalTime value={a.createdAt} midSentence /> // "asked yesterday 14:20"
 *
 * The first render prints the UTC form and the local one lands after mount:
 * the static export is rendered with no time zone, and printing the server's
 * zone first would be a hydration mismatch.
 */
export interface LocalTimeProps extends React.TimeHTMLAttributes<HTMLTimeElement> {
  value: string | number | Date | null | undefined;
  dateOnly?: boolean;
  /** Append the zone ("Oct 18, 14:00 GMT+1"): use it for deadlines. */
  withZone?: boolean;
  /** In UTC, labelled ("Today 07:32 UTC"): the money-screen convention (`formatUtcDateTime`). */
  utc?: boolean;
  /** "4 min ago" within the hour, "Today 14:20" later today — for live lists. */
  relative?: boolean;
  /** The time sits inside a sentence: "asked yesterday 14:20", not "asked Yesterday 14:20". */
  midSentence?: boolean;
  /** Name the day even when it is today ("Today 14:20"), as the receipt timeline and debt banner do. */
  alwaysDay?: boolean;
}

export function LocalTime({
  value,
  dateOnly = false,
  withZone = false,
  utc = false,
  relative = false,
  midSentence = false,
  alwaysDay = false,
  className,
  ...props
}: LocalTimeProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const date = value === null || value === undefined || value === "" ? null : new Date(value);
  const iso = date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
  const options = { midSentence, alwaysDay };
  const text = !mounted
    ? (utcTitle(value) ?? "—")
    : dateOnly
      ? formatLocalDate(value)
      : utc
        ? formatUtcDateTime(value, options)
        : withZone
        ? `${formatLocalDateTime(value, options)} ${zoneLabel(value)}`.trim()
        : relative
          ? formatRelative(value, { midSentence })
          : formatLocalDateTime(value, options);

  return (
    <time dateTime={iso} title={utcTitle(value)} className={cn("tabular-nums", className)} {...props}>
      {text}
    </time>
  );
}
