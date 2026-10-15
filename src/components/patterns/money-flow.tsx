import { ArrowRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Where money went, drawn instead of explained.
 *
 * `MoneyFlow` is a strip of nodes joined by arrows:
 *
 *   <MoneyFlow nodes={[
 *     { label: "Held", amount: "$0.10" },
 *     { label: "Check failed", tone: "danger" },
 *     { label: "Released", amount: "$0.10", tone: "teal" },
 *   ]} />
 *
 * `MoneySplit` is one stacked bar with a legend — how a whole divides:
 *
 *   <MoneySplit total={{ label: "Listed", amount: "$12.40" }} segments={[
 *     { label: "Charged", value: 11.2, amount: "$11.20", tone: "primary" },
 *     { label: "Not charged", value: 1.2, amount: "$1.20", tone: "teal" },
 *   ]} />
 *
 * Amounts are passed already formatted (`formatMoney`), so this file never
 * touches money arithmetic. `value` on a split segment is only a proportion
 * for the bar's widths — pass `toDecimal(m).toNumber()` or a count.
 */

export type MoneyTone = "neutral" | "primary" | "success" | "danger" | "warning" | "teal" | "info" | "indigo";

const NODE_TONE: Record<MoneyTone, string> = {
  neutral: "border-01 bg-02 text-01",
  primary: "border-primary-20 bg-primary-10 text-primary-700",
  success: "border-success-20 bg-success-10 text-success-700",
  danger: "border-danger-20 bg-danger-10 text-danger-700",
  warning: "border-warning-20 bg-warning-10 text-warning-700",
  teal: "border-teal-20 bg-teal-10 text-teal-600",
  info: "border-info-20 bg-info-10 text-info-600",
  indigo: "border-indigo-20 bg-indigo-10 text-indigo-500",
};

const FILL_TONE: Record<MoneyTone, string> = {
  neutral: "bg-chart-6",
  primary: "bg-primary-500",
  success: "bg-success-500",
  danger: "bg-danger-500",
  warning: "bg-warning-500",
  teal: "bg-teal-500",
  info: "bg-info-500",
  indigo: "bg-indigo-500",
};

export interface MoneyFlowNode {
  label: React.ReactNode;
  /** Already formatted, e.g. "$0.10". */
  amount?: string;
  tone?: MoneyTone;
  /** One short line under the node, e.g. a time. */
  note?: React.ReactNode;
}

export interface MoneyFlowProps {
  nodes: MoneyFlowNode[];
  /** Spoken summary. Default joins the nodes: "Held $0.10, then Check failed, then Released $0.10". */
  ariaLabel?: string;
  className?: string;
}

function plain(node: React.ReactNode): string {
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

export function moneyFlowSummary(nodes: readonly MoneyFlowNode[]): string {
  return nodes
    .map((node) => [plain(node.label), node.amount].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", then ");
}

export function MoneyFlow({ nodes, ariaLabel, className }: MoneyFlowProps) {
  return (
    <div role="img" aria-label={ariaLabel ?? moneyFlowSummary(nodes)} className={cn(
        // A column on phones: a wrapped row strands an arrow at a line end.
        "flex w-full flex-col items-start gap-1 tablet:flex-row tablet:flex-wrap tablet:items-center tablet:gap-x-1.5 tablet:gap-y-2",
        className,
      )}
    >
      {nodes.map((node, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <ArrowRight aria-hidden="true" className="ml-3 size-3.5 shrink-0 rotate-90 text-03 tablet:ml-0 tablet:rotate-0" /> : null}
          <span aria-hidden="true" className="flex flex-col gap-0.5">
            <span
              className={cn(
                "inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-md border px-2 py-1",
                NODE_TONE[node.tone ?? "neutral"],
              )}
            >
              <span className="text-label-xs">{node.label}</span>
              {node.amount ? <span className="font-mono text-mono-12 font-semibold">{node.amount}</span> : null}
            </span>
            {node.note ? <span className="pl-0.5 text-body-xs text-03">{node.note}</span> : null}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface MoneySplitSegment {
  label: React.ReactNode;
  /** Proportion only. Negative values are treated as 0. */
  value: number;
  /** Already formatted, e.g. "$11.20" or "60%". */
  amount: string;
  tone?: MoneyTone;
  /** Short muted note after the amount. */
  note?: React.ReactNode;
}

export interface MoneySplitProps {
  segments: MoneySplitSegment[];
  /** The whole, shown above the bar: "Listed $12.40". */
  total?: { label: React.ReactNode; amount: string };
  /** Show each segment's share as a percentage in the legend. Default true. */
  showPercent?: boolean;
  className?: string;
}

/** Each segment's share of the whole, 0–100, summing to 100 (or all 0 for an empty whole). */
export function splitPercents(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum === 0) return clean.map(() => 0);
  return clean.map((v) => (v / sum) * 100);
}

function formatPercent(p: number): string {
  if (p === 0) return "0%";
  if (p < 1) return "<1%";
  if (p > 99 && p < 100) return ">99%";
  return `${Math.round(p)}%`;
}

export function MoneySplit({ segments, total, showPercent = true, className }: MoneySplitProps) {
  const percents = splitPercents(segments.map((s) => s.value));
  const empty = percents.every((p) => p === 0);

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {total ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body-13 text-02">{total.label}</span>
          <span className="font-mono text-mono-sm font-semibold text-01">{total.amount}</span>
        </div>
      ) : null}
      <div aria-hidden="true" className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-03">
        {empty
          ? null
          : segments.map((segment, index) =>
              percents[index]! > 0 ? (
                <span
                  key={index}
                  className={cn("h-full first:rounded-l-full last:rounded-r-full", FILL_TONE[segment.tone ?? "neutral"])}
                  style={{ width: `${percents[index]}%`, minWidth: 3 }}
                />
              ) : null,
            )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {segments.map((segment, index) => (
          <li key={index} className="flex items-center gap-2.5">
            <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-sm", FILL_TONE[segment.tone ?? "neutral"])} />
            <span className="min-w-0 flex-1 text-body-13 text-02">
              {segment.label}
              {segment.note ? <span className="text-03"> · {segment.note}</span> : null}
            </span>
            {showPercent && !empty ? (
              <span className="shrink-0 font-mono text-mono-12 text-03">{formatPercent(percents[index]!)}</span>
            ) : null}
            <span className="w-[84px] shrink-0 text-right font-mono text-mono-13 font-semibold text-01">{segment.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
