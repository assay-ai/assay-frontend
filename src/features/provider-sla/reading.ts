import { formatClock, formatLocalDate, type LocalTimeOptions } from "@/libs/local-time";
import type { SlaWindow, SlaWindowOutcome } from "@/interfaces";

/**
 * A window's numbers as sentences a provider can act on:
 *
 *   "1.6% of calls failed this window (you promised at most 2%)"
 *   "Not enough calls yet (6 of 400)"                 below the sample gate
 *   "Oct 13, 15:00 – 17:00"                           a window by its dates, never "w_48"
 */

export type SlaTone = "ok" | "warning" | "danger" | "neutral";

function pct(rate: number): string {
  const value = rate * 100;
  return `${Number(value.toFixed(value < 10 ? 1 : 0))}%`;
}

export interface SlaReading {
  /** "1.6% of calls failed this window (you promised at most 2%)", or null before any checked call. */
  headline: string | null;
  tone: SlaTone;
  /** "Not enough calls yet (6 of 400)" while a penalty cannot happen at all. */
  sample: string | null;
  /** One sentence on what it means. */
  advice: string;
  /** How much of the promise is used, 0..1+ (null without a rate). */
  used: number | null;
}

export function slaReading(window: Pick<SlaWindow, "status" | "verifiedCalls" | "failedCalls" | "minVerifiedCalls" | "observedFailureRate" | "declaredFailureRate"> | null, declared: number | null): SlaReading {
  if (!window) {
    return {
      headline: null,
      tone: "neutral",
      sample: null,
      advice: "No calls yet. Your promise is measured from the first call on.",
      used: null,
    };
  }
  const promise = declared ?? window.declaredFailureRate;
  const rate =
    window.observedFailureRate ?? (window.verifiedCalls > 0 ? window.failedCalls / window.verifiedCalls : null);
  const sampleShort = window.verifiedCalls < window.minVerifiedCalls;
  const sample = sampleShort
    ? `Not enough calls yet (${window.verifiedCalls.toLocaleString("en-US")} of ${window.minVerifiedCalls.toLocaleString("en-US")})`
    : null;
  if (rate === null || promise <= 0) {
    return { headline: null, tone: "neutral", sample, advice: "No checked calls in this window yet.", used: null };
  }
  const used = rate / promise;
  const scope = window.status === "OPEN" ? "this window" : "last window";
  const headline = `${pct(rate)} of calls failed ${scope} (you promised at most ${pct(promise)})`;
  let tone: SlaTone = used > 1 ? "danger" : used >= 0.75 ? "warning" : "ok";
  let advice: string;
  if (sampleShort) {
    tone = used > 1 ? "warning" : tone;
    advice =
      used > 1
        ? "Above your promise, but too few calls to judge. No penalty is possible until the window has enough calls."
        : "Too few calls to judge yet. No penalty is possible until the window has enough calls.";
  } else if (used > 1) {
    advice = "Above your promise. If it stays there until the window closes, part of your stake can be taken. Fix your API or pause the tool.";
  } else if (used >= 0.75) {
    advice = "Close to your promise. Check recent failures before it goes over.";
  } else {
    advice = "Well inside your promise.";
  }
  return { headline, tone, sample, advice, used };
}

/** "Oct 13, 15:00 – 17:00" (same day) or "Oct 13, 15:00 – Oct 14, 09:00"; "since Oct 13, 15:00" while open. */
export function windowRange(window: Pick<SlaWindow, "openedAt" | "closedAt" | "status" | "deadlineAt">, options: LocalTimeOptions = {}): string {
  const start = `${formatLocalDate(window.openedAt, options)}, ${formatClock(window.openedAt, options)}`;
  if (window.status === "OPEN" || !window.closedAt) {
    return `Since ${start}`;
  }
  const sameDay = formatLocalDate(window.openedAt, options) === formatLocalDate(window.closedAt, options);
  const end = sameDay
    ? formatClock(window.closedAt, options)
    : `${formatLocalDate(window.closedAt, options)}, ${formatClock(window.closedAt, options)}`;
  return `${start} – ${end}`;
}

export const WINDOW_OUTCOME: Record<SlaWindowOutcome, string> = {
  WITHIN_SLA: "Kept your promise",
  INSUFFICIENT_SAMPLE: "Too few calls to judge",
  BREACH_PROPOSED: "Over the promise · penalty proposed",
};
