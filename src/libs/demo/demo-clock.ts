/**
 * DEMO ONLY: the one "now" every demo fixture counts from.
 *
 * Read once, rounded down to a ten-minute mark, and kept in sessionStorage
 * and localStorage: a reload, a client navigation, a new tab and every screen
 * (provider penalties and windows, operator approvals and arbiter deadlines,
 * buyer receipts and debt deadlines) then show the same instant for the same
 * event. Counting from `Date.now()` at each read, or from the start of the
 * current hour, made the same deadline move between screens and jump an hour
 * on a reload (provider review 2026-10-16b); a minute-rounded base kept only
 * per tab still moved a debt's "Settle by" minute between tabs and after
 * cleared session storage (buyer retest 2026-10-17). The ten-minute mark keeps
 * two fresh starts a few minutes apart on the same instant.
 *
 * A base older than `DEMO_CLOCK_MAX_AGE_MS` starts over once, so the
 * deadlines stay plausible. Without a window or storage (build, tests, a
 * private window that refuses storage) it is this load's own mark.
 * Countdowns still tick with the real clock; only the fixtures stand still.
 */

const KEY = "demo-now";
export const DEMO_CLOCK_MAX_AGE_MS = 6 * 3_600_000;
const GRID_MS = 10 * 60_000;

function stored(storage: Storage | undefined, real: number): number | null {
  const value = Number(storage?.getItem(KEY));
  return Number.isFinite(value) && value > 0 && real >= value && real - value < DEMO_CLOCK_MAX_AGE_MS ? value : null;
}

/** The base for a page loaded at `real` (ms). Exported for tests. */
export function readDemoClock(real: number): number {
  const rounded = Math.floor(real / GRID_MS) * GRID_MS;
  let base = rounded;
  try {
    base = stored(window.sessionStorage, real) ?? stored(window.localStorage, real) ?? rounded;
  } catch {
    return rounded;
  }
  for (const storage of ["sessionStorage", "localStorage"] as const) {
    try {
      window[storage].setItem(KEY, String(base));
    } catch {
      /* this storage refuses writes: the other one, or this load's own mark */
    }
  }
  return base;
}

/** The demo's "now", in ms, fixed for the session. */
export const DEMO_NOW_MS = readDemoClock(Date.now());

/** ISO time `minutes` before the demo's "now" (negative: after it). */
export function demoMinutesAgo(minutes: number): string {
  return new Date(DEMO_NOW_MS - minutes * 60_000).toISOString();
}
