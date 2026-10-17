import { formatClock, formatDate, type TimeOptions, ZONE_LABEL } from "@/libs/utc-time";
import type { SlaWindow, SlaWindowOutcome } from "@/interfaces";

/**
 * A window's numbers as sentences a provider can act on:
 *
 *   "In this check window (last 4 days), 1.6% of calls failed (you promised at most 2%)"
 *   "Not enough calls yet (6 of 400)"                 below the sample gate
 *   "Oct 13, 15:00 – 17:00"                           a window by its dates, never "w_48"
 */

/**
 * The minimum sample before a window can lead to a penalty, for copy written
 * before any window exists (landing, wizard). The backend's
 * `MIN_VERIFIED_CALLS` (400), frozen onto each window when it opens; a live
 * window's own `minVerifiedCalls` always wins over this.
 */
export const MIN_CHECKED_CALLS = 400;

export type SlaTone = "ok" | "warning" | "danger" | "neutral";

function pct(rate: number): string {
  const value = rate * 100;
  return `${Number(value.toFixed(value < 10 ? 1 : 0))}%`;
}

export interface SlaReading {
  /** "In this check window (last 4 days), 1.6% of calls failed (you promised at most 2%)", or null before any checked call. */
  headline: string | null;
  tone: SlaTone;
  /** "Not enough calls yet (6 of 400)" while a penalty cannot happen at all. */
  sample: string | null;
  /** One sentence on what it means. */
  advice: string;
  /** How much of the promise is used, 0..1+ (null without a rate). */
  used: number | null;
}

/** "4 days" / "6 h": a window's length, whole days from a day up. */
function spanText(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The window a provider-console failure rate covers, so it is never read bare
 * next to the public all-time figure (final2 P3): "this check window (last 4
 * days)" while open — counted from `openedAt` — and "the last check window
 * (7 days)" once closed. Without the dates, just the window.
 */
export function checkWindowScope(
  window: Pick<SlaWindow, "status"> & Partial<Pick<SlaWindow, "openedAt" | "closedAt">>,
  now: number = Date.now(),
): string {
  const opened = window.openedAt ? Date.parse(window.openedAt) : Number.NaN;
  if (window.status === "OPEN") {
    return Number.isNaN(opened) || opened > now ? "this check window" : `this check window (last ${spanText(now - opened)})`;
  }
  const closed = window.closedAt ? Date.parse(window.closedAt) : Number.NaN;
  return Number.isNaN(opened) || Number.isNaN(closed) || closed < opened
    ? "the last check window"
    : `the last check window (${spanText(closed - opened)})`;
}

export function slaReading(
  window:
    | (Pick<SlaWindow, "status" | "verifiedCalls" | "failedCalls" | "minVerifiedCalls" | "observedFailureRate" | "declaredFailureRate"> &
        Partial<Pick<SlaWindow, "openedAt" | "closedAt">>)
    | null,
  declared: number | null,
  options: { now?: number } = {},
): SlaReading {
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
  const scope = checkWindowScope(window, options.now);
  const headline = `In ${scope}, ${pct(rate)} of calls failed (you promised at most ${pct(promise)})`;
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

/** "Oct 13, 15:00 – 17:00 UTC" (same day) or "Oct 13, 15:00 – Oct 14, 09:00 UTC"; "Since Oct 13, 15:00 UTC" while open. */
export function windowRange(window: Pick<SlaWindow, "openedAt" | "closedAt" | "status" | "deadlineAt">, options: TimeOptions = {}): string {
  const start = `${formatDate(window.openedAt, options)}, ${formatClock(window.openedAt, options)}`;
  if (window.status === "OPEN" || !window.closedAt) {
    return `Since ${start} ${ZONE_LABEL}`;
  }
  const sameDay = formatDate(window.openedAt, options) === formatDate(window.closedAt, options);
  const end = sameDay
    ? formatClock(window.closedAt, options)
    : `${formatDate(window.closedAt, options)}, ${formatClock(window.closedAt, options)}`;
  return `${start} – ${end} ${ZONE_LABEL}`;
}

export const WINDOW_OUTCOME: Record<SlaWindowOutcome, string> = {
  WITHIN_SLA: "Kept your promise",
  INSUFFICIENT_SAMPLE: "Too few calls to judge",
  BREACH_PROPOSED: "Over the promise · penalty proposed",
};

/**
 * The windows one tool's Quality tab lists: only that tool's, newest first,
 * and at most one open (the newest) — a list that mixed tools or showed two
 * open windows would contradict the headline above it.
 */
export function recentWindows<W extends Pick<SlaWindow, "windowId" | "bindingId" | "status" | "openedAt">>(
  windows: readonly W[],
  bindingId: string,
): W[] {
  const own = windows
    .filter((window) => !bindingId || window.bindingId === bindingId)
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  let seenOpen = false;
  return own.filter((window) => {
    if (window.status !== "OPEN") return true;
    if (seenOpen) return false;
    seenOpen = true;
    return true;
  });
}

/** "1.4%" — the observed failure rate of a window, or null before any checked call. */
export function windowRate(window: Pick<SlaWindow, "observedFailureRate" | "verifiedCalls">): string | null {
  if (window.observedFailureRate === null || window.observedFailureRate === undefined || window.verifiedCalls === 0) return null;
  const value = window.observedFailureRate * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}
