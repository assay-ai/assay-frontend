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

// ── Finding a penalty ───────────────────────────────────────────────────────

/** Where the console learned of a penalty: the only lists the backend has. */
export type KnownPenaltySource = "disputed" | "activity" | "recent";

export interface KnownPenalty {
  id: string;
  providerId: string;
  /** "Northwind Geo's $28.47 penalty". */
  label: string;
  source: KnownPenaltySource;
}

export const KNOWN_SOURCE_TEXT: Record<KnownPenaltySource, string> = {
  disputed: "disputed on chain",
  activity: "acted on, in Activity",
  recent: "opened in this browser",
};

/**
 * Every penalty the console can name, from the lists that exist —
 * disputed on chain, acted on by an operator (Activity), opened in this
 * browser — one row per penalty (the first source wins), narrowed to the
 * providers whose name matches `query`. Pure.
 */
export function knownPenalties(
  sources: { disputed: readonly KnownPenalty[]; activity: readonly KnownPenalty[]; recent: readonly KnownPenalty[] },
  providerName: (providerId: string) => string,
  query: string,
): KnownPenalty[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: KnownPenalty[] = [];
  for (const row of [...sources.disputed, ...sources.activity, ...sources.recent]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (q && !providerName(row.providerId).toLowerCase().includes(q) && !row.label.toLowerCase().includes(q)) continue;
    out.push(row);
  }
  return out;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The penalty id in a pasted id or any link that carries one, lower-cased; `null` when none. Pure. */
export function penaltyIdFrom(text: string): string | null {
  return UUID_RE.exec(text.trim())?.[0]?.toLowerCase() ?? null;
}
