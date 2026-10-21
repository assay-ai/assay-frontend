/**
 * The report windows the provider screens ask `GET /providers/me/earnings`
 * about, in ONE form each, so that two screens asking about the same window
 * send the same request under the same query key.
 */

/** This UTC month: its first day 00:00 to the next month's. */
export function monthWindow(now: Date): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

/** The last 30 days, in whole UTC days: to the end of today (00:00 tomorrow), so the window is the same all day. */
export function last30DaysWindow(now: Date): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** `GET /providers/me/earnings` by tool for a window: the one key every screen uses for it. */
export function earningsKey(window: { from: string; to: string }) {
  return ["provider", "earnings", "tool", window.from, window.to] as const;
}
