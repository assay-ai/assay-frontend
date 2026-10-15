/**
 * Penalties this browser opened lately — the way back to a penalty nobody
 * disputed, which no endpoint lists yet [backend: a list of open penalties by
 * provider]. Per browser and per viewer only (localStorage); losing it costs a
 * pasted link, nothing more.
 */
export interface RecentPenalty {
  id: string;
  providerId: string;
  /** "Northwind Geo's $28.47 penalty". */
  label: string;
  /** When it was last opened, ISO. */
  at: string;
}

const KEY = "operator-recent-penalties";
export const RECENT_PENALTIES_MAX = 10;

/** The list with `entry` first, without its older copy, capped. Pure. */
export function withRecent(list: readonly RecentPenalty[], entry: RecentPenalty): RecentPenalty[] {
  return [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, RECENT_PENALTIES_MAX);
}

/** Rows whose label (provider name included) matches the typed text. Pure. */
export function filterRecent(list: readonly RecentPenalty[], query: string): RecentPenalty[] {
  const q = query.trim().toLowerCase();
  return q ? list.filter((item) => item.label.toLowerCase().includes(q)) : [...list];
}

function isRecent(value: unknown): value is RecentPenalty {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.providerId === "string" && typeof row.label === "string" && typeof row.at === "string";
}

export function readRecentPenalties(): RecentPenalty[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENT_PENALTIES_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRecentPenalty(entry: RecentPenalty): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(withRecent(readRecentPenalties(), entry)));
  } catch {
    /* storage refused: the list just stays as it was */
  }
}
