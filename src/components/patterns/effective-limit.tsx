"use client";

import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import type { Money } from "@/interfaces";
import { cn } from "@/utils";
import { toDecimal } from "@/utils/money";

/**
 * One answer to "the most this agent can spend now, and why", across the
 * three systems that each cap it: the escrow's safety caps (on chain), the
 * agent's own pay permission (on chain) and the budget (checked by Assay).
 * The lowest wins, and the row says which one that is.
 *
 *   <EffectiveLimit
 *     rows={[
 *       { id: "call", label: "Per call", sources: [
 *         { source: "Safety caps", value: escrow.maxVoucherAmount },
 *         { source: "Agent permission", value: grant.maxVoucherAmount },
 *         { source: "Budget", value: policy.perCallMax } ] },
 *       { id: "day", label: "Per day", sources: [...] },
 *     ]} />
 *   → "Per call  $0.50  set by Agent permission"
 *
 * A source with `value: null` has no ceiling and never wins. `used` turns the
 * row into "left now": the smallest (limit − used) across sources.
 */
export interface LimitSource {
  /** Who sets it, in the buyer's words: "Safety caps", "Agent permission", "Budget". */
  source: string;
  /** `null` = this source sets no ceiling here. */
  value: Money | null;
  /** Spent against it in its current window, when known. */
  used?: Money | null;
  /** E.g. "24 h window", "calendar day (UTC)". */
  note?: string;
  /** Enforced by a contract (true) rather than checked by Assay's software. */
  onChain?: boolean;
}

export interface EffectiveLimitRow {
  id: string;
  label: string;
  sources: LimitSource[];
}

export interface ResolvedLimit {
  /** The binding ceiling, or `null` when no source sets one. */
  value: Money | null;
  /** Which source it comes from. */
  source: string | null;
  /** Whether that source is enforced on chain. */
  onChain: boolean;
  /** Smallest amount left across sources that report `used`; `null` when none do. */
  left: Money | null;
  leftSource: string | null;
}

export function resolveLimit(sources: readonly LimitSource[]): ResolvedLimit {
  let best: LimitSource | null = null;
  let left: { money: Money; source: string } | null = null;
  for (const s of sources) {
    if (!s.value) continue;
    if (!best || toDecimal(s.value).lt(toDecimal(best.value!))) best = s;
    if (s.used) {
      const remaining = toDecimal(s.value).minus(toDecimal(s.used));
      const clamped = remaining.isNegative() ? toDecimal({ ...s.value, amount: "0" }) : remaining;
      const money: Money = {
        ...s.value,
        amount: clamped.mul(10 ** s.value.decimals).toFixed(0),
      };
      if (!left || toDecimal(money).lt(toDecimal(left.money))) left = { money, source: s.source };
    }
  }
  return {
    value: best?.value ?? null,
    source: best?.source ?? null,
    onChain: best?.onChain === true,
    left: left?.money ?? null,
    leftSource: left?.source ?? null,
  };
}

/** "At most $0.50 a call and $10.00 a day." — the summary sentence. */
export function effectiveSentence(rows: readonly EffectiveLimitRow[]): string {
  const parts = rows
    .map((row) => ({ row, resolved: resolveLimit(row.sources) }))
    .filter(({ resolved }) => resolved.value)
    .map(({ row, resolved }) => `${formatLimit(resolved.value)} ${row.label.toLowerCase().replace(/^per /, "a ")}`);
  if (parts.length === 0) return "No limit is set, so only your balance stops spending.";
  return `At most ${parts.join(" and ")}.`;
}

export interface EffectiveLimitProps {
  title?: React.ReactNode;
  rows: EffectiveLimitRow[];
  /** When everything is stopped (paused, withdrawal pending): the sentence replaces the figures' meaning. */
  stopped?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function EffectiveLimit({ title = "What this agent can spend", rows, stopped, footer, className }: EffectiveLimitProps) {
  return (
    <section
      aria-label={typeof title === "string" ? title : "Effective limit"}
      className={cn("flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5", className)}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-label-md text-01">{title}</h2>
        <p className={cn("text-body-13", stopped ? "text-danger-600" : "text-02")}>{stopped ?? effectiveSentence(rows)}</p>
      </div>
      <dl className="flex w-full flex-col divide-y divide-01">
        {rows.map((row) => {
          const resolved = resolveLimit(row.sources);
          const others = row.sources.filter((s) => s.source !== resolved.source);
          return (
            <div key={row.id} className="flex w-full flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
              <div className="flex w-full items-baseline justify-between gap-3">
                <dt className="text-body-13 text-02">{row.label}</dt>
                <dd className="font-mono text-mono-sm font-semibold text-01">
                  {resolved.value ? formatLimit(resolved.value) : "No limit"}
                </dd>
              </div>
              <p className="text-body-xs text-03">
                {resolved.source ? (
                  <>
                    Set by <span className="text-02">{resolved.source}</span>
                    {resolved.left ? (
                      <>
                        {" "}
                        · {formatLimit(resolved.left)} left now
                        {resolved.leftSource && resolved.leftSource !== resolved.source ? ` (${resolved.leftSource})` : ""}
                      </>
                    ) : null}
                  </>
                ) : (
                  "None of your limits sets one."
                )}
                {others.length > 0 ? (
                  <>
                    {" · "}
                    {others
                      .map((s) => `${s.source}: ${s.value ? formatLimit(s.value) : "no limit"}`)
                      .join(" · ")}
                  </>
                ) : null}
              </p>
            </div>
          );
        })}
      </dl>
      {footer ? <div className="text-body-xs text-03">{footer}</div> : null}
    </section>
  );
}
