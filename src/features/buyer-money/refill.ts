/**
 * When a cap is full again. Three clocks, and each screen must use the right one:
 *
 * - escrow caps and an agent's pay permission: a 24 h window that starts at
 *   the first payment after the last window ended (`windowStartedAt` +
 *   `windowSeconds`), not at midnight;
 * - a daily budget: the next 00:00 UTC;
 * - a monthly budget: the first of next month, 00:00 UTC.
 */

/** ISO instant the rolling window ends, or `null` when it is not running (full already). */
export function windowRefillAt(
  windowStartedAt: string | null | undefined,
  windowSeconds: number,
  nowMs: number = Date.now(),
): string | null {
  if (!windowStartedAt || !(windowSeconds > 0)) return null;
  const start = Date.parse(windowStartedAt);
  if (Number.isNaN(start)) return null;
  const end = start + windowSeconds * 1000;
  return end > nowMs ? new Date(end).toISOString() : null;
}

/** Next 00:00 UTC after `nowMs`. */
export function nextUtcMidnight(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

/** The first of next month, 00:00 UTC. */
export function nextUtcMonth(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}
