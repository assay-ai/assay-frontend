"use client";

import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { formatRemaining, useCountdown } from "@/hooks/useCountdown";
import { formatDateTime } from "@/libs/utc-time";
import { cn } from "@/utils";

import type { NeedsActionItem, WatchItem } from "./needs-action";

function Deadline({ at }: { at: string }) {
  const { msLeft, hasPassed } = useCountdown(at);
  const [title, setTitle] = React.useState<string | undefined>(undefined);
  React.useEffect(() => setTitle(formatDateTime(at)), [at]);
  if (msLeft === null) return null;
  const urgent = msLeft < 24 * 3_600_000;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-label-xs",
        urgent ? "bg-danger-10 text-danger-700" : "bg-03 text-02",
      )}
    >
      <Clock aria-hidden="true" className="size-3" />
      {hasPassed ? "Time is up" : `${formatRemaining(msLeft)} left`}
      {hasPassed ? null : (
        <>
          {" "}· by <UtcTime value={at} />
        </>
      )}
    </span>
  );
}

export function NeedsActionStrip({
  items,
  onOpenStake,
  loading,
}: {
  items: NeedsActionItem[];
  onOpenStake: () => void;
  loading?: boolean;
}) {
  if (loading) return null;
  if (items.length === 0) {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-lg border border-01 bg-01 px-4 py-3">
        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-600" />
        <p className="text-body-13 text-02">Nothing needs you right now. Penalties, failing tools and stake warnings show up here.</p>
      </div>
    );
  }
  return (
    <section aria-labelledby="needs-action-title" className="flex w-full flex-col gap-2">
      <h2 id="needs-action-title" className="text-label-md text-01">
        Needs action <span className="text-03">· {items.length}</span>
      </h2>
      <ul className="flex w-full flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "flex w-full flex-col gap-3 rounded-lg border p-3.5 tablet:flex-row tablet:items-center",
              item.tone === "danger" ? "border-danger-20 bg-danger-10" : "border-warning-20 bg-warning-10",
            )}
          >
            <CircleAlert
              aria-hidden="true"
              className={cn("hidden size-4 shrink-0 tablet:block", item.tone === "danger" ? "text-danger-600" : "text-warning-600")}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-label-13 text-01">{item.title}</p>
                {item.deadline ? <Deadline at={item.deadline} /> : null}
              </div>
              <p className="text-body-xs text-02">{item.detail}</p>
            </div>
            {"href" in item.action ? (
              <Button size="sm" variant="secondary" asChild className="self-start tablet:self-center">
                <Link href={item.action.href}>{item.action.label}</Link>
              </Button>
            ) : (
              <Button size="sm" className="self-start tablet:self-center" onClick={onOpenStake}>
                {item.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Warnings that need no action yet (D20: a window over the promise with too
 * few calls for a penalty). Said in the Quality tab's words, in the warning
 * tone, and not counted in "Needs action" or the badge.
 */
export function WatchList({ items }: { items: readonly WatchItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex w-full flex-col gap-2" aria-label="Warnings, no action needed yet">
      {items.map((item) => (
        <li key={item.id} className="flex w-full flex-col gap-3 rounded-lg border border-warning-20 bg-01 p-4 tablet:flex-row tablet:items-center tablet:gap-3.5">
          <CircleAlert aria-hidden="true" className="hidden size-4 shrink-0 text-warning-600 tablet:block" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-label-sm leading-[1.4] text-01">{item.title}</p>
            <p className="text-body-13 leading-[1.55] text-02">{item.detail}</p>
          </div>
          <Button size="sm" variant="secondary" asChild className="self-start tablet:self-center">
            <Link href={item.href}>See quality</Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
