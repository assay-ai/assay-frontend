import { formatDate } from "@/libs/utc-time";

/**
 * What a new API key may do, and when it ends (`POST /agents/:agentId/credentials`
 * `scopes` and `expiresAt`). The API refuses a key every route did not open to
 * one of these scopes; the person's own session is never limited by them.
 *
 * - `tools:call`: list, search and call tools.
 * - `payments`: take part in paid calls (needs `tools:call`).
 * - `activity:read`: read its own balance, calls and receipts.
 * - `reports:write`: report a bad result. Off unless asked for.
 * - `deposits:write`: create a deposit request for its own agent and report the
 *   transaction the agent's wallet sent for it. It never signs or moves funds,
 *   needs no other scope, and is off unless asked for. Polling the deposit
 *   needs `activity:read`.
 */
export type KeyScope = "tools:call" | "payments" | "activity:read" | "reports:write" | "deposits:write";

export type KeyPresetId = "agent" | "free" | "read";

export interface KeyPreset {
  id: KeyPresetId;
  label: string;
  hint: string;
  scopes: readonly KeyScope[];
}

export const KEY_PRESETS: readonly KeyPreset[] = [
  {
    id: "agent",
    label: "Agent",
    hint: "Calls tools, pays for paid calls within your limits, and reads its own activity.",
    scopes: ["tools:call", "payments", "activity:read"],
  },
  { id: "free", label: "Free calls only", hint: "Calls tools, but can never pay.", scopes: ["tools:call"] },
  { id: "read", label: "Read only", hint: "Reads its own activity. It cannot call tools or pay.", scopes: ["activity:read"] },
];

export const DEFAULT_KEY_PRESET: KeyPresetId = "agent";
export const REPORTS_SCOPE: KeyScope = "reports:write";
export const DEPOSITS_SCOPE: KeyScope = "deposits:write";

/** What the "Can create deposits" option grants, in the key form. */
export const DEPOSITS_HINT = "Create deposit requests and report deposits this agent's wallet sent. It never moves funds.";

/**
 * The scopes a key made with `preset` gets; "Can report bad results" adds `reports:write` (not on Read only),
 * "Can create deposits" adds `deposits:write` (on any preset: it needs no other scope).
 */
export function scopesFor(preset: KeyPresetId, canReport = false, canDeposit = false): KeyScope[] {
  const chosen = KEY_PRESETS.find((p) => p.id === preset) ?? KEY_PRESETS[0]!;
  const scopes = [...chosen.scopes];
  if (canReport && preset !== "read") scopes.push(REPORTS_SCOPE);
  if (canDeposit) scopes.push(DEPOSITS_SCOPE);
  return scopes;
}

/** The expiry choices, in days. A key always expires: there is no "never" (the API allows at most 365). */
export const KEY_EXPIRY_DAYS = [30, 90, 365] as const;
export type KeyExpiryDays = (typeof KEY_EXPIRY_DAYS)[number];
export const DEFAULT_KEY_EXPIRY_DAYS: KeyExpiryDays = 90;

export function expiryLabel(days: KeyExpiryDays): string {
  return days === 365 ? "1 year" : `${days} days`;
}

/**
 * The current choice in one line, shown next to the closed "Advanced" section:
 * "Agent · expires in 90 days", "Free calls only · can report · can create deposits · expires in 1 year".
 */
export function keyChoiceSummary(preset: KeyPresetId, canReport: boolean, days: KeyExpiryDays, canDeposit = false): string {
  const label = (KEY_PRESETS.find((p) => p.id === preset) ?? KEY_PRESETS[0]!).label;
  const report = canReport && preset !== "read" ? " · can report" : "";
  const deposit = canDeposit ? " · can create deposits" : "";
  return `${label}${report}${deposit} · expires in ${expiryLabel(days)}`;
}

const DAY_MS = 86_400_000;

/** `expiresAt` for a key that lasts `days` from `nowMs`. */
export function expiresAtFor(days: KeyExpiryDays, nowMs: number = Date.now()): string {
  return new Date(nowMs + days * DAY_MS).toISOString();
}

/** The body of `POST /agents/:agentId/credentials`. */
export function createKeyBody(
  name: string,
  choice: { preset?: KeyPresetId; canReport?: boolean; canDeposit?: boolean; days?: KeyExpiryDays } = {},
  nowMs: number = Date.now(),
): { name: string; scopes: KeyScope[]; expiresAt: string } {
  return {
    name,
    scopes: scopesFor(choice.preset ?? DEFAULT_KEY_PRESET, choice.canReport ?? false, choice.canDeposit ?? false),
    expiresAt: expiresAtFor(choice.days ?? DEFAULT_KEY_EXPIRY_DAYS, nowMs),
  };
}

/**
 * What a key may do, in plain words: "Calls tools · pays · reads activity".
 * An unknown scope grants nothing on the API, so it is not shown.
 */
export function scopesText(scopes: readonly string[] | null | undefined): string {
  const has = (scope: KeyScope) => (scopes ?? []).includes(scope);
  const parts: string[] = [];
  if (has("tools:call")) parts.push("calls tools");
  if (has("payments") && has("tools:call")) parts.push("pays");
  if (has("activity:read")) parts.push("reads activity");
  if (has("reports:write")) parts.push("reports bad results");
  if (has("deposits:write")) parts.push("creates deposits");
  if (parts.length === 0) return "Can do nothing";
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A key that ends within this many days is said to expire soon. */
export const EXPIRES_SOON_DAYS = 7;

export interface KeyExpiryView {
  text: string;
  soon: boolean;
}

/** "Expires Jan 20, 2027" (soon within a week), "Expired Oct 1", or null when it has no end date. */
export function keyExpiry(expiresAt: string | null | undefined, nowMs: number = Date.now()): KeyExpiryView | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  const date = formatDate(expiresAt, { now: nowMs });
  if (at <= nowMs) return { text: `Expired ${date}`, soon: false };
  return { text: `Expires ${date}`, soon: at - nowMs <= EXPIRES_SOON_DAYS * DAY_MS };
}

/** The key can take part in paid calls: it holds `payments` (and `tools:call`). */
export function keyMayPay(scopes: readonly string[] | null | undefined): boolean {
  return (scopes ?? []).includes("payments") && (scopes ?? []).includes("tools:call");
}
