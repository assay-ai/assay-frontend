/**
 * Formatting shared by the verdict feed and detail.
 */

import type { BadgeVariant } from "@/components/ui/badge";
import { DASH } from "@/features/g34a/stats";
import type { RetentionState, VerdictRecordState, VerdictStatus } from "@/interfaces";

/** The 72h evidence-body retention window — the verdict table's "BODIES KEPT 72H" policy. */
export const RETENTION_HOURS = 72;

/**
 * `verdictStatus` (+ `state`, for the not-yet-judged case) → the closed Badge
 * vocabulary. Mirrors `provider/flags/page.tsx`'s `badgeFor`, which reads the
 * same `VerdictStatus` off a different DTO — kept as a second copy rather
 * than shared, because that file's row type (`ProviderCallRow`, parsed from a
 * CSV export) and this screen's (`ProviderVerdictListItem`, a real JSON row)
 * are not the same shape and forcing one to import the other would couple
 * two unrelated data sources.
 */
export function badgeForVerdict(item: {
  verdictStatus: VerdictStatus | null;
  state: VerdictRecordState;
}): BadgeVariant {
  switch (item.verdictStatus) {
    case "PASS":
      return "passed";
    case "FAIL":
      return "failed";
    case "DEGRADED":
      return "degraded";
    case "SKIPPED":
      return "not-sampled";
    case "EMPTY_CONFIRMED":
      return "passed";
    case "MISAPPLIED":
      return "failed";
    default:
      return item.state === "PENDING" ? "checking" : "unverified";
  }
}

/** `0.40`, `1.00` — the design's own precision. `null` renders `DASH`, never `0.00`. */
export function scoreText(score: number | null): string {
  return score === null ? DASH : score.toFixed(2);
}

/** Every failed verifier's code, joined — `DASH` when nothing failed or nothing parses. */
export function failingRulesText(failingRules: readonly string[]): string {
  return failingRules.length > 0 ? failingRules.join(" · ") : DASH;
}

export function countedText(counted: boolean | null): string {
  if (counted === null) return DASH;
  return counted ? "yes" : "no";
}

/**
 * `retentionState` + `createdAt` → what the row's evidence body access looks
 * like right now.
 *
 * There is no "hours remaining" field on the wire — `retentionState` is only
 * ever `'RAW' | 'DIGESTED' | null`. The countdown is derived from two real
 * numbers this codebase already treats as authoritative: the row's own
 * `createdAt` and the documented 72h retention policy (the verdict table's "BODIES KEPT
 * 72H" chip states the same constant). That is a computation over real data,
 * not a fabricated figure — unlike the design's per-row "available 34h" /
 * "available 33h", which decrement by exactly 1h per row regardless of the
 * actual gap between calls and cannot be reproduced from any field this API
 * returns; this function does not attempt to match those exact numbers.
 */
export function retentionLabel(
  retentionState: RetentionState | null,
  createdAtIso: string,
  nowMs: number,
  bodiesExpireAtIso?: string | null
): string {
  if (retentionState === null) return DASH;
  if (retentionState === "DIGESTED") return "hashes only";
  const remainingHours = hoursUntilExpiry(createdAtIso, nowMs, bodiesExpireAtIso);
  if (remainingHours === null) return DASH;
  return remainingHours > 0 ? `available ${Math.ceil(remainingHours)}h` : "expiring";
}

/** Hours remaining for a RAW row, or `null` for anything else — for the page-level chip. */
export function retentionHoursRemaining(
  retentionState: RetentionState | null,
  createdAtIso: string,
  nowMs: number,
  bodiesExpireAtIso?: string | null
): number | null {
  if (retentionState !== "RAW") return null;
  const remaining = hoursUntilExpiry(createdAtIso, nowMs, bodiesExpireAtIso);
  if (remaining === null) return null;
  return remaining > 0 ? remaining : 0;
}

/**
 * Bodies are kept 72h from SEALING, which can be a day after the verdict's
 * `createdAt`. `bodiesExpireAt` is the server's own figure and wins; the
 * `createdAt` estimate is only for a response that does not carry it.
 */
function hoursUntilExpiry(
  createdAtIso: string,
  nowMs: number,
  bodiesExpireAtIso?: string | null
): number | null {
  const expiresMs = bodiesExpireAtIso
    ? new Date(bodiesExpireAtIso).getTime()
    : new Date(createdAtIso).getTime() + RETENTION_HOURS * 3_600_000;
  return Number.isNaN(expiresMs) ? null : (expiresMs - nowMs) / 3_600_000;
}
