"use client";

import * as React from "react";

import { formatLocalDate, formatLocalDateTime, formatRelative, utcTitle } from "@/libs/local-time";
import { cn } from "@/utils";

/**
 * A server timestamp, shown in the reader's own time zone, with the exact UTC
 * instant in the tooltip and in `dateTime`.
 *
 *   <LocalTime value={call.createdAt} />            // "14:20" / "Oct 16, 14:20"
 *   <LocalTime value={x.expiresAt} dateOnly />       // "Oct 16"
 *
 * The first render prints the UTC form and the local one lands after mount:
 * the static export is rendered with no time zone, and printing the server's
 * zone first would be a hydration mismatch.
 */
export interface LocalTimeProps extends React.TimeHTMLAttributes<HTMLTimeElement> {
  value: string | number | Date | null | undefined;
  dateOnly?: boolean;
  /** "4 min ago" within the hour, "Today 14:20" later today — for live lists. */
  relative?: boolean;
}

export function LocalTime({ value, dateOnly = false, relative = false, className, ...props }: LocalTimeProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const date = value === null || value === undefined || value === "" ? null : new Date(value);
  const iso = date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
  const text = !mounted
    ? (utcTitle(value) ?? "—")
    : dateOnly
      ? formatLocalDate(value)
      : relative
        ? formatRelative(value)
        : formatLocalDateTime(value);

  return (
    <time dateTime={iso} title={utcTitle(value)} className={cn("tabular-nums", className)} {...props}>
      {text}
    </time>
  );
}
