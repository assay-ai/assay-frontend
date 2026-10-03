import * as React from "react";

import { cn } from "@/utils";

/**
 * Shared chrome for the buyer console screens.
 *
 * Every one of these screens opens with the same page header (24px/600 title
 * over a 12px mono subtitle, actions right) and most of them repeat the
 * design's small "dot + LABEL" status pill. Neither is a design-system
 * component: `Panel` has its own header for panel titles, and `Badge`
 * deliberately refuses arbitrary text because Foundations rule 03 forbids a
 * raw verdict reaching the screen.
 *
 * `StatusPill` therefore exists for the NON-verdict labels the design draws
 * (WAITING, APPROVED, EXPIRED, CONNECTED, VERIFIED, STOP/TELL/ASK,
 * NOT SUPPRESSIBLE, ONE-TIME LINK). It must never be handed a verification
 * verdict — that goes through `presentVerdict()` from `@/utils/verdict`.
 */

export interface PageHeaderProps {
  title: string;
  /** 12px mono, `$text-03`, verbatim from the design. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-heading-md text-01">{title}</h1>
        {subtitle ? <p className="font-mono text-mono-12 text-03">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

const PILL_TONES = {
  neutral: { bg: "bg-03", text: "text-02", dot: "bg-text-03" },
  success: { bg: "bg-success-10", text: "text-success-700", dot: "bg-success-500" },
  warning: { bg: "bg-warning-10", text: "text-warning-700", dot: "bg-warning-500" },
  danger: { bg: "bg-danger-10", text: "text-danger-700", dot: "bg-danger-500" },
  primary: { bg: "bg-primary-10", text: "text-primary-600", dot: "bg-primary-500" },
  teal: { bg: "bg-teal-10", text: "text-teal-600", dot: "bg-teal-500" },
} as const;

export type PillTone = keyof typeof PILL_TONES;

export interface StatusPillProps {
  label: string;
  tone?: PillTone;
  /** The design draws some pills (ONE-TIME LINK) without the leading dot. */
  dot?: boolean;
  className?: string;
}

export function StatusPill({ label, tone = "neutral", dot = true, className }: StatusPillProps) {
  const config = PILL_TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 font-mono text-mono-xs font-semibold",
        config.bg,
        config.text,
        className
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dot)} /> : null}
      {label}
    </span>
  );
}

/**
 * The design's key/value row: sans key on the left, mono value on the right,
 * 10px of vertical padding. Used in the Limits ASK panel, the provider detail
 * "Who is behind this" rail, Settings and Statements.
 */
export function KeyValueRow({
  label,
  sub,
  value,
  valueClassName,
  divider = true,
}: {
  label: React.ReactNode;
  sub?: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-4 py-2.5",
        divider && "border-b border-01 last:border-b-0"
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body-13 text-02">{label}</span>
        {sub ? <span className="text-body-xs text-03">{sub}</span> : null}
      </div>
      <span className={cn("shrink-0 text-right font-mono text-mono-13 font-semibold text-01", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

/**
 * The bordered stat card the explorer screens use (provider card stats, the
 * provider detail six-across strip). Distinct from `MetricTile`, which is the 32px money
 * headline on the Money bench — these are 20px and sit six to a row.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "teal";
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-lg border border-01 bg-01 p-4">
      <span className="text-body-xs text-03">{label}</span>
      <span
        className={cn(
          "font-mono text-heading-sm",
          tone === "teal" ? "text-teal-600" : "text-01"
        )}
      >
        {value}
      </span>
      {sub ? <span className="text-mono-xs font-sans text-03">{sub}</span> : null}
    </div>
  );
}

/** The 10px mono column header / section label the design uses everywhere. */
export function MicroLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-mono-2xs text-03", className)}>{children}</span>;
}

/**
 * Two-letter mark for a provider logo. The design draws hand-picked initials
 * ("X4", "CG", "MT"); with only a legal name on the wire, first letters of the
 * first two words is the closest deterministic equivalent.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
