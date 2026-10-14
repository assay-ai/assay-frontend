"use client";

import { AlertTriangle, Inbox, Lock } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

/**
 * Every "not the content yet" state a screen has, in one component:
 *
 *   <PageState kind="loading" rows={4} />
 *   <PageState kind="empty" title="No agents yet"
 *     description="An agent is what calls tools on your behalf."
 *     action={{ label: "Create an agent", href: "/agents?new=1" }} />
 *   <PageState kind="error" description="We could not read your balance."
 *     onRetry={() => query.refetch()} code={error.code} details={error.message} />
 *   <PageState kind="blocked" title="Account paused"
 *     description="Paid calls are paused while we review a payment." />
 *
 * Rules it enforces:
 *  - loading is a skeleton in the shape of the content, never a bare "Loading…";
 *  - empty says what the thing is and offers ONE next action;
 *  - error is a plain sentence plus Retry; the raw code sits under "Details";
 *  - blocked says why, and what (if anything) fixes it.
 */

/* ------------------------------------------------------------------ */

/** A grey block that stands in for content while it loads. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-03", className)} {...props} />;
}

/** Rows of skeleton lines in the shape of a list. */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex w-full items-center gap-3 border-b border-01 py-3.5 last:border-b-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {/* Varying widths read as text, identical ones read as a broken table. */}
            <Skeleton className={cn("h-3.5", index % 2 === 0 ? "w-2/5" : "w-1/3")} />
            <Skeleton className={cn("h-3", index % 3 === 0 ? "w-3/5" : "w-1/2")} />
          </div>
          <Skeleton className="h-3.5 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface PageStateAction {
  label: string;
  /** A link, for "go somewhere". */
  href?: string;
  /** A handler, for "do something here". One of the two. */
  onClick?: () => void;
  icon?: React.ReactNode;
}

interface BaseProps {
  className?: string;
  /** Drop the card frame, for a state shown inside a Panel that already has one. */
  bare?: boolean;
}

export type PageStateProps = BaseProps &
  (
    | {
        kind: "loading";
        /** Skeleton rows. Default 3. */
        rows?: number;
        /** What is loading, for screen readers: "Loading your agents". */
        label?: string;
      }
    | {
        kind: "empty";
        title: React.ReactNode;
        description?: React.ReactNode;
        /** The one next step. */
        action?: PageStateAction;
        icon?: React.ReactNode;
      }
    | {
        kind: "error";
        /** Default: "Something went wrong". */
        title?: React.ReactNode;
        /** One plain sentence: what could not be done. */
        description?: React.ReactNode;
        onRetry?: () => void;
        /** Raw error code, shown only under Details. */
        code?: string | null;
        /** Raw message, shown only under Details. */
        details?: string | null;
      }
    | {
        kind: "blocked";
        title: React.ReactNode;
        description?: React.ReactNode;
        action?: PageStateAction;
      }
  );

function ActionButton({ action, variant = "primary" }: { action: PageStateAction; variant?: "primary" | "secondary" }) {
  if (action.href) {
    return (
      <Button variant={variant} asChild className="self-start">
        <Link href={action.href}>
          {action.icon}
          {action.label}
        </Link>
      </Button>
    );
  }
  return (
    <Button variant={variant} icon={action.icon} onClick={action.onClick} className="self-start">
      {action.label}
    </Button>
  );
}

const FRAME = "flex w-full flex-col gap-2.5 rounded-xl border border-01 bg-02 p-6 tablet:p-8";

export function PageState(props: PageStateProps) {
  const { className, bare } = props;
  const frame = cn(bare ? "flex w-full flex-col gap-2.5 py-6" : FRAME, className);

  if (props.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className={cn("w-full", className)}>
        <span className="sr-only">{props.label ?? "Loading"}</span>
        <SkeletonRows rows={props.rows ?? 3} />
      </div>
    );
  }

  if (props.kind === "empty") {
    return (
      <div className={frame}>
        <div className="text-03">{props.icon ?? <Inbox aria-hidden="true" width={22} height={22} />}</div>
        <p className="text-label-md text-01">{props.title}</p>
        {props.description ? <p className="max-w-[520px] text-body-13 text-02">{props.description}</p> : null}
        {props.action ? (
          <div className="pt-1.5">
            <ActionButton action={props.action} />
          </div>
        ) : null}
      </div>
    );
  }

  if (props.kind === "error") {
    const hasDetails = Boolean(props.code || props.details);
    return (
      <div role="alert" className={frame}>
        <AlertTriangle aria-hidden="true" className="size-[22px] text-danger-500" />
        <p className="text-label-md text-01">{props.title ?? "Something went wrong"}</p>
        <p className="max-w-[520px] text-body-13 text-02">
          {props.description ?? "We could not load this. Check your connection and try again."}
        </p>
        {props.onRetry ? (
          <div className="pt-1.5">
            <Button variant="secondary" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
        {hasDetails ? (
          <details className="group pt-1">
            <summary className="cursor-pointer select-none text-label-13 text-03 hover:text-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              Details
            </summary>
            <p className="mt-1.5 break-all font-mono text-mono-12 text-03">
              {[props.code, props.details].filter(Boolean).join(" · ")}
            </p>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div className={frame}>
      <Lock aria-hidden="true" className="size-[22px] text-warning-500" />
      <p className="text-label-md text-01">{props.title}</p>
      {props.description ? <p className="max-w-[520px] text-body-13 text-02">{props.description}</p> : null}
      {props.action ? (
        <div className="pt-1.5">
          <ActionButton action={props.action} variant="secondary" />
        </div>
      ) : null}
    </div>
  );
}
