"use client";

import Decimal from "decimal.js";
import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import type { Money } from "@/interfaces";
import { formatDateTime, utcTitle, type TimeOptions } from "@/libs/utc-time";
import { cn } from "@/utils";
import { toDecimal } from "@/utils/money";

/**
 * How much of a cap is used, how much is left, and when it fills again — as a
 * bar and one sentence. Shared by escrow caps, agent grants and budgets.
 *
 *   <CapMeter label="Today" used={spentToday} limit={dailyCap} refillsAt={nextMidnight} />
 *   → "$0.46 left of $2.00 · full again ~14:20"
 *
 * Over or at the limit, the sentence says what that means for calls instead
 * of showing a red bar and leaving the reader to work it out.
 */

export interface CapSentenceInput {
  used: Money;
  /** `null` = no cap set (e.g. escrow caps not configured): reads "No limit set yet". */
  limit: Money | null;
  /** ISO instant when the cap is full again (window reset). */
  refillsAt?: string | null;
  /** What happens at the limit. Default "Paid calls are refused". */
  consequence?: string;
  /**
   * What the refill time means, appended after it: "your time; 24 h after the
   * window's first payment". A rolling window and a calendar day read the same
   * otherwise.
   */
  refillHint?: string;
}

/**
 * The amount used as the meter prints it: rounded UP to the cent (when the
 * limit is at least a cent), so "used" and "left" always add up to the limit.
 * Both used to round down, so $2.605 used of $10 read "$2.60" next to
 * "$7.39 left".
 */
export function shownUsed(used: Money, limit: Money | null): Money {
  if (!limit || toDecimal(limit).lt("0.01")) return used;
  const up = toDecimal(used).toDecimalPlaces(2, Decimal.ROUND_UP);
  return { ...used, amount: up.mul(new Decimal(10).pow(used.decimals)).toFixed(0) };
}

export type CapLevel = "ok" | "high" | "full" | "over" | "none" | "unset";

export interface CapReading {
  level: CapLevel;
  /** 0–100, clamped. */
  percent: number;
  sentence: string;
}

/** Pure: the sentence and level, so every screen says the same words. */
export function capReading(input: CapSentenceInput, options: TimeOptions = {}): CapReading {
  if (!input.limit) {
    return { level: "unset", percent: 0, sentence: "No limit set yet, so this cannot pay. Set one to start." };
  }
  const cap = input.limit;
  const used = toDecimal(shownUsed(input.used, cap));
  const limit = toDecimal(cap);
  // "~14:20 UTC" for today; "Tomorrow 00:00 UTC" / "Oct 20, 14:20 UTC" read better without the tilde.
  const at = input.refillsAt ? formatDateTime(input.refillsAt, options) : null;
  const when = at && /^\d{2}:\d{2} UTC$/.test(at) ? `~${at}` : at?.replace(/^(Yesterday|Tomorrow)/, (word) => word.toLowerCase()) ?? null;
  const consequence = input.consequence ?? "Paid calls are refused";
  const money = (value: Decimal): string =>
    formatLimit({ amount: value.mul(new Decimal(10).pow(cap.decimals)).toFixed(0), asset: cap.asset, decimals: cap.decimals });

  if (limit.lte(0)) {
    return {
      level: "none",
      percent: 0,
      sentence: `The limit is $0.00, so nothing can be spent. ${consequence} until it is raised.`,
    };
  }

  const percent = Math.min(100, Math.max(0, used.div(limit).mul(100).toNumber()));
  const hint = when && input.refillHint ? ` (${input.refillHint})` : "";
  const until = when ? `until it refills ${when}${hint}` : "until the limit is raised";

  if (used.gt(limit)) {
    return {
      level: "over",
      percent: 100,
      sentence: `${money(used.minus(limit))} over the limit (${money(used)} of ${money(limit)}). ${consequence} ${until}.`,
    };
  }
  if (used.eq(limit)) {
    return {
      level: "full",
      percent: 100,
      sentence: `All ${money(limit)} used. ${consequence} ${until}.`,
    };
  }
  const left = `${money(limit.minus(used))} left of ${money(limit)}`;
  return {
    level: percent >= 80 ? "high" : "ok",
    percent,
    sentence: when ? `${left} · full again ${when}${hint}` : left,
  };
}

const FILL: Record<CapLevel, string> = {
  ok: "bg-primary-500",
  high: "bg-warning-500",
  full: "bg-danger-500",
  over: "bg-danger-500",
  none: "bg-danger-500",
  unset: "bg-chart-6",
};

export interface CapMeterProps extends CapSentenceInput {
  /** "Per day", "Per call", "This month". */
  label: React.ReactNode;
  className?: string;
}

export function CapMeter({ label, used, limit, refillsAt, consequence, refillHint, className }: CapMeterProps) {
  const reading = capReading({ used, limit, refillsAt, consequence, refillHint });
  const alarm = reading.level === "full" || reading.level === "over" || reading.level === "none";
  const muted = reading.level === "unset";

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <div className="flex w-full items-baseline justify-between gap-3">
        <span className="text-label-13 text-01">{label}</span>
        <span className="font-mono text-mono-13 text-02">
          {limit ? (
            <>
              {formatLimit(shownUsed(used, limit))} <span className="text-03">of</span> {formatLimit(limit)}
            </>
          ) : (
            "Not set"
          )}
        </span>
      </div>
      <div
        role="meter"
        aria-label={typeof label === "string" ? label : "Limit used"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(reading.percent)}
        aria-valuetext={reading.sentence}
        className="h-2 w-full overflow-hidden rounded-full bg-03"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", FILL[reading.level])} style={{ width: `${reading.percent}%` }} />
      </div>
      <p className={cn("text-body-xs", alarm ? "text-danger-600" : muted ? "text-warning-700" : "text-03")} title={refillsAt ? utcTitle(refillsAt) : undefined}>
        {reading.sentence}
      </p>
    </div>
  );
}
