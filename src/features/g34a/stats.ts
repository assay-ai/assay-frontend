/**
 * The small numeric vocabulary the four provider SLA/traffic screens share.
 *
 * ## What is derived here, and what moved server-side
 *
 * A **99% Wilson interval** is computed here, from two counts a window
 * actually carries. It is a statistic over real numbers, the design labels the
 * quantity "99% CI" itself, and the binding detail screen (`bindings/[bindingId]/page.tsx`) still
 * uses this copy — `/providers/me/sla-windows` has no per-window live-position
 * sub-resource for the provider-wide fold the binding detail screen reads, so there is no server
 * interval for that caller to prefer. Keep this function for the binding detail screen.
 *
 * The SLA workbench and the SLA window screen are different: `GET
 * /providers/me/sla-windows/{windowId}` and `GET
 * /providers/me/bindings/{bindingId}/sla` both return a
 * server-computed `confidenceInterval` (or, for the SLA workbench's measured rate,
 * `measured.confidenceInterval`) alongside the position it was computed from.
 * Both screens now prefer the server's interval over calling `wilson99` here,
 * so the client and the server can never disagree about an interval a
 * provider reads in a dispute — the exact failure mode a client-side
 * recomputation would eventually hit the day the server's Z-score or formula
 * moves and this copy does not.
 *
 * The **minimum verified sample** (the design writes 400) and the **effective
 * threshold** it feeds (`declared + 2.58·√(p(1−p)/400)`) used to be refused
 * outright here, because no endpoint published either. Now
 * `SlaWindow.minVerifiedCalls` is a real per-window field,
 * `SlaWindowPosition.effectiveThresholdAtClose` (the SLA window screen) and
 * `BindingSla.effectiveThreshold` (the SLA workbench) are both pre-computed server-side.
 * Neither 400 nor 2.58 is hard-coded anywhere in this codebase — the SLA workbench and
 * The SLA window screen read both numbers off the wire.
 */

/** The one glyph for "no honest source", as the design's own cells use it. */
export const DASH = "—";

export function count(n: number | null | undefined): string {
  return n === null || n === undefined ? DASH : n.toLocaleString("en-US");
}

export function percent(rate: number | null | undefined, digits = 2): string {
  return rate === null || rate === undefined ? DASH : `${(rate * 100).toFixed(digits)}%`;
}

/**
 * Wilson score interval at 99%.
 *
 * Wilson rather than the normal approximation because these counts are small
 * and one-sided: 0 failures in 4 verified calls has a real upper bound, and
 * the normal interval collapses it to zero width — which would tell a provider
 * their rate is known exactly when it is barely known at all.
 */
export function wilson99(successes: number, trials: number): [number, number] | null {
  if (trials <= 0) return null;
  const z = 2.5758293035489004;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** `▲ 4% vs yesterday`, the design's own trend line. */
export function trend(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return DASH;
  if (previous === 0) return `${DASH} vs yesterday`;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct < 0 ? "▼" : "▲"} ${Math.abs(pct)}% vs yesterday`;
}

/** `2026-08-10 09:01` — the stamp format the design's panel sub lines use. */
export function stampUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** `12:41:02` — the verdict table Time column, in UTC because every other stamp is. */
export function clockUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** `51h 12m`, as the SLA window screen sub line writes elapsed time. */
export function elapsed(fromIso: string, nowMs: number): string {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return DASH;
  const mins = Math.max(0, Math.floor((nowMs - from) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
