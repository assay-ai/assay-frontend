"use client";

import { CheckCircle2, ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/utils";

/**
 * What an operator sees after an action went through: what happened, what
 * happens next, and where the record of it is (the Activity entry, the
 * transaction). Replaces "toast and hope".
 *
 *   <ResultCard
 *     title="Block lifted on wallet 0x9f3c…f36c"
 *     next="It applies at once on every instance."
 *     activityHref={approvalActivityHref(row)}
 *   />
 */
export interface ResultCardProps {
  title: React.ReactNode;
  /** One sentence: what happens next. */
  next?: React.ReactNode;
  /** "queued" for a two-person request sent for approval. Default "done". */
  tone?: "done" | "queued";
  activityHref?: string | null;
  txUrl?: string | null;
  /** Extra link, e.g. "Open in approvals". */
  link?: { label: string; href: string } | null;
  onDismiss?: () => void;
  className?: string;
}

export function ResultCard({ title, next, tone = "done", activityHref, txUrl, link, onDismiss, className }: ResultCardProps) {
  const Icon = tone === "queued" ? Send : CheckCircle2;
  return (
    <div
      role="status"
      className={cn(
        "flex w-full gap-3 rounded-lg border p-3.5",
        tone === "queued" ? "border-primary-20 bg-primary-10" : "border-success-20 bg-success-10",
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "queued" ? "text-primary-600" : "text-success-600")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label-13 text-01 [overflow-wrap:anywhere]">{title}</p>
        {next ? <p className="text-body-13 text-02">{next}</p> : null}
        <p className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
          {link ? (
            <Link href={link.href} className="text-label-13 text-primary-600 hover:underline">
              {link.label}
            </Link>
          ) : null}
          {activityHref ? (
            <Link href={activityHref} className="text-label-13 text-primary-600 hover:underline">
              See it in Activity
            </Link>
          ) : null}
          {txUrl ? (
            <a href={txUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-label-13 text-primary-600 hover:underline">
              View transaction
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ) : null}
          {onDismiss ? (
            <button type="button" onClick={onDismiss} className="text-label-13 text-03 hover:text-01">
              Dismiss
            </button>
          ) : null}
        </p>
      </div>
    </div>
  );
}
