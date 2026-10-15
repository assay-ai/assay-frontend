import type { EscrowDelegate } from "@/interfaces";

/**
 * When an agent's permission to pay runs out soon. The grant is valid for a
 * fixed number of days (`validUntil`); once it passes, paid calls are refused
 * with no other warning, so the agent card and Overview say so a week ahead.
 */
export const EXPIRY_WARNING_DAYS = 7;

const DAY_MS = 86_400_000;

export interface PermissionExpiry {
  /** Whole days left (0 = ends within the next 24 hours). */
  daysLeft: number;
  validUntil: string;
  /** "in 3 days", "in 1 day", "within a day". */
  label: string;
}

/** The expiry to warn about, or `null` (no grant, not active, far off, already over, or unreadable). */
export function permissionExpiry(
  grant: Pick<EscrowDelegate, "status" | "validUntil"> | null | undefined,
  nowMs: number,
  warnDays = EXPIRY_WARNING_DAYS,
): PermissionExpiry | null {
  if (!grant || grant.status !== "ACTIVE") return null;
  const until = Date.parse(grant.validUntil);
  if (Number.isNaN(until) || until <= nowMs) return null;
  const msLeft = until - nowMs;
  if (msLeft > warnDays * DAY_MS) return null;
  const daysLeft = Math.floor(msLeft / DAY_MS);
  const label = daysLeft === 0 ? "within a day" : `in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
  return { daysLeft, validUntil: grant.validUntil, label };
}
