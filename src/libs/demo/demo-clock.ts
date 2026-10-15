/**
 * DEMO ONLY: the one "now" every demo fixture counts from.
 *
 * Read once per browser tab session, rounded to the minute and kept in
 * sessionStorage: a reload, a client navigation and every screen (provider
 * penalties and windows, operator approvals and arbiter deadlines, buyer
 * receipts) then show the same instant for the same event. Counting from
 * `Date.now()` at each read, or from the start of the current hour, made the
 * same deadline move between screens and jump an hour on a reload (provider
 * review 2026-10-16b).
 *
 * A session older than `DEMO_CLOCK_MAX_AGE_MS` starts over once, so the
 * deadlines stay plausible. Without a window or storage (build, tests, a
 * private window that refuses storage) it is this module load's own minute.
 * Countdowns still tick with the real clock; only the fixtures stand still.
 */

const KEY = "demo-now";
export const DEMO_CLOCK_MAX_AGE_MS = 6 * 3_600_000;

/** The session base for a page loaded at `real` (ms). Exported for tests. */
export function readDemoClock(real: number): number {
  const rounded = Math.floor(real / 60_000) * 60_000;
  try {
    const stored = Number(window.sessionStorage.getItem(KEY));
    if (Number.isFinite(stored) && stored > 0 && real >= stored && real - stored < DEMO_CLOCK_MAX_AGE_MS) return stored;
    window.sessionStorage.setItem(KEY, String(rounded));
  } catch {
    /* no window or no storage: this load's own minute */
  }
  return rounded;
}

/** The demo's "now", in ms, fixed for the session. */
export const DEMO_NOW_MS = readDemoClock(Date.now());

/** ISO time `minutes` before the demo's "now" (negative: after it). */
export function demoMinutesAgo(minutes: number): string {
  return new Date(DEMO_NOW_MS - minutes * 60_000).toISOString();
}
