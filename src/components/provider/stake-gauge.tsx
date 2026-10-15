import Decimal from "decimal.js";
import * as React from "react";

import type { Money } from "@/interfaces";
import { cn } from "@/utils";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * "Stake $600 / needed $450 / recommended $675" as one bar: the fill is what
 * is staked, with ticks where "needed" and "recommended" sit. Green when the
 * stake covers what is needed, amber below the recommended cushion, red when
 * short. Every figure is also printed, so colour is never the only signal.
 */
export function gaugePercents(staked: Money | null, needed: Money | null, recommended: Money | null) {
  const s = staked ? toDecimal(staked) : new Decimal(0);
  const n = needed ? toDecimal(needed) : null;
  const r = recommended ? toDecimal(recommended) : null;
  const top = Decimal.max(s, n ?? 0, r ?? 0, 1).mul(1.1);
  const pct = (v: Decimal | null) => (v === null ? null : Math.min(100, v.div(top).mul(100).toNumber()));
  const tone: "success" | "warning" | "danger" | "neutral" =
    n === null ? "neutral" : s.lt(n) ? "danger" : r !== null && s.lt(r) ? "warning" : "success";
  return { staked: pct(s)!, needed: pct(n), recommended: pct(r), tone };
}

const FILL = {
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  neutral: "bg-primary-400",
} as const;

export function StakeGauge({
  staked,
  needed,
  recommended,
  className,
}: {
  staked: Money | null;
  needed: Money | null;
  recommended: Money | null;
  className?: string;
}) {
  const p = gaugePercents(staked, needed, recommended);
  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-heading-md font-semibold text-01">{staked ? formatMoney(staked) : "$0.00"}</span>
        <span className="text-body-13 text-03">staked</span>
      </div>
      <div
        className="relative h-3 w-full rounded-full bg-03"
        role="meter"
        aria-label="Stake against what your tools need"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.staked)}
      >
        <div className={cn("h-3 rounded-full", FILL[p.tone])} style={{ width: `${p.staked}%` }} />
        {p.needed !== null ? (
          <span className="absolute -top-1 h-5 w-0.5 rounded bg-inverse" style={{ left: `${p.needed}%` }} aria-hidden="true" />
        ) : null}
        {p.recommended !== null ? (
          <span className="absolute -top-1 h-5 w-0.5 rounded bg-inverse opacity-40" style={{ left: `${p.recommended}%` }} aria-hidden="true" />
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-body-xs">
        <div className="flex flex-col">
          <dt className="text-03">Staked</dt>
          <dd className="font-mono text-mono-13 text-01">{staked ? formatMoney(staked) : "$0.00"}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="flex items-center gap-1 text-03"><span aria-hidden="true" className="h-3 w-0.5 rounded bg-inverse" />Needed</dt>
          <dd className="font-mono text-mono-13 text-01">{needed ? formatMoney(needed) : "Nothing yet"}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="flex items-center gap-1 text-03"><span aria-hidden="true" className="h-3 w-0.5 rounded bg-inverse opacity-40" />Recommended</dt>
          <dd className="font-mono text-mono-13 text-01">{recommended ? formatMoney(recommended) : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
