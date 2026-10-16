"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, Gauge, Info, Settings, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { AlertBadge } from "@/components/ui/alert-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { attentionAction } from "@/features/buyer/attention-action";
import { listNotifications } from "@/services/account.service";
import { cn } from "@/utils";

/**
 * The bell: a popover with the latest alerts — each opening what it is about —
 * and a link to Alert settings. Before, the bell navigated straight to the
 * settings page, so the newest alert was two clicks and a sheet away.
 *
 * Built on the dropdown menu (Radix) for focus, Escape and arrow keys.
 */

interface AlertRow {
  id: string;
  event: string;
  severity: "INFO" | "WARNING" | "CRITICAL" | string;
  title: string;
  body?: string | null;
  readAt?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  createdAt: string;
}

const SHOWN = 6;

const ICON: Record<string, React.ReactNode> = {
  INFO: <Info aria-hidden="true" className="size-4 text-primary-500" />,
  WARNING: <Gauge aria-hidden="true" className="size-4 text-warning-500" />,
  CRITICAL: <TriangleAlert aria-hidden="true" className="size-4 text-danger-500" />,
};

/** The same alert raised twice in one minute is one row. Pure, for tests. */
export function recentAlerts(items: readonly AlertRow[], limit = SHOWN): AlertRow[] {
  const seen = new Set<string>();
  const out: AlertRow[] = [];
  for (const item of items) {
    const key = `${item.title}|${String(item.createdAt).slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function AlertsMenu({ count, variant = "desktop" }: { count: number; variant?: "desktop" | "mobile" }) {
  const [open, setOpen] = React.useState(false);
  const feed = useQuery({
    queryKey: ["notifications", "bell"],
    enabled: open,
    retry: 0,
    queryFn: () => listNotifications({ limit: 20 }) as Promise<{ items: AlertRow[] }>,
  });
  const rows = recentAlerts(feed.data?.items ?? []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {variant === "desktop" ? (
          <AlertBadge count={count} label={count > 0 ? `${count} unread alerts. Open recent alerts` : "Recent alerts"} />
        ) : (
          <button
            type="button"
            aria-label={count > 0 ? `${count} unread alerts. Open recent alerts` : "Recent alerts"}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5",
              count > 0 ? "bg-warning-10" : "bg-03",
              "before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
            )}
          >
            <Bell className={cn("h-4 w-4", count > 0 ? "text-warning-600" : "text-03")} />
            {count > 0 ? <span className="font-mono text-mono-sm text-warning-700">{count > 9 ? "9+" : count}</span> : null}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[min(360px,calc(100vw-32px))] border border-01 p-0">
        <DropdownMenuLabel className="px-4 pb-2 pt-3 text-label-13 text-01">Recent alerts</DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-[360px] overflow-y-auto py-1">
          {feed.isPending ? (
            <p className="px-4 py-3 text-body-13 text-03">Loading alerts…</p>
          ) : feed.isError ? (
            <p className="px-4 py-3 text-body-13 text-02">Recent alerts could not be loaded. Try again in a moment.</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-3 text-body-13 text-02">No alerts yet. When something needs you, it shows here.</p>
          ) : (
            rows.map((row) => {
              const action = attentionAction(row);
              const body = (
                <span className="flex w-full items-start gap-2.5">
                  <span className="mt-0.5 shrink-0">{ICON[row.severity] ?? ICON.INFO}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn("text-body-13", row.readAt ? "text-02" : "font-medium text-01")}>{row.title}</span>
                    <span className="text-body-xs text-03">
                      <UtcTime value={row.createdAt} relative />
                      {action ? ` · ${action.label}` : ""}
                    </span>
                  </span>
                </span>
              );
              return (
                <DropdownMenuItem key={row.id} asChild={Boolean(action)} className="cursor-pointer px-4 py-2.5">
                  {action ? <Link href={action.href}>{body}</Link> : body}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        {/* The badge counts unread alerts; the list above is only the latest few,
            so the way to all of them carries the badge's number. */}
        <DropdownMenuItem asChild className="cursor-pointer px-4 py-2.5 text-label-13 text-primary-600">
          <Link href="/alerts?view=recent">
            <Bell aria-hidden="true" className="mr-2 size-3.5" />
            {count > 0 ? `See all alerts (${count} unread)` : "See all alerts"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer px-4 py-2.5 text-label-13 text-primary-600">
          <Link href="/alerts">
            <Settings aria-hidden="true" className="mr-2 size-3.5" />
            Alert settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
