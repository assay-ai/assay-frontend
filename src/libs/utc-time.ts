/**
 * Times for people. Everything is UTC (owner rule): no time a person reads is
 * in their own zone, and every moment says "UTC" so nobody wonders whose
 * afternoon it is. Day words ("Today", "Yesterday") and per-day groups follow
 * the UTC day too, the same day the backend groups by.
 *
 * Use `formatDateTime` for a moment ("14:20 UTC", "Yesterday 09:05 UTC",
 * "Oct 16, 14:20 UTC"), `formatDate` for a day ("Oct 16"), `formatClock` for a
 * bare "14:20" inside a phrase that adds the label itself, and `utcTitle` as
 * the `title` of the element — `<UtcTime>` in components/patterns/utc-time.tsx
 * does all of it.
 *
 * Only the receipt timeline shows seconds, because the steps of one call are
 * often seconds apart, and it says so once above the rows (`timelineZoneNote`).
 *
 * Every function takes an optional `now`, so tests are not at the mercy of the
 * machine's clock. The machine's zone never matters.
 */

export interface TimeOptions {
  /** Add seconds ("14:20:07") — for a step-by-step timeline. Off by default. */
  seconds?: boolean;
  /** "Now", for relative labels. Defaults to Date.now(). */
  now?: number;
  /** "Today 14:20 UTC" rather than a bare "14:20 UTC", where a time alone could be any day (a timeline, a deadline). */
  alwaysDay?: boolean;
  /**
   * The time sits inside running text ("asked today 04:06 UTC", "sign before
   * tomorrow 19:06 UTC"): the day words are lowercase. Off by default, for a
   * time that stands alone or starts a sentence ("Today 14:20 UTC").
   */
  midSentence?: boolean;
}

/** The one zone every time is shown in, and its label. */
export const TIME_ZONE = "UTC";
export const ZONE_LABEL = "UTC";

const LOCALE = "en-US";
const DAY_MS = 86_400_000;

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The UTC calendar day of a date ("2026-10-16"): used to compare "same day". */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "14:20" — 24-hour UTC clock, unlabelled: for a phrase that says "UTC" itself. */
export function formatClock(value: string | number | Date | null | undefined, options: TimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  }).format(date);
}

/** "Oct 16" (this year) or "Oct 16, 2025" — the UTC day. */
export function formatDate(value: string | number | Date | null | undefined, options: TimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  const now = new Date(options.now ?? Date.now());
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** "Today" / "today", as the position in the sentence wants it. */
function dayWord(word: "Today" | "Yesterday" | "Tomorrow", options: TimeOptions): string {
  return options.midSentence ? word.toLowerCase() : word;
}

/** The moment without its label: "14:20", "Yesterday 14:20", "Oct 16, 14:20". */
function dateTimeText(date: Date, options: TimeOptions): string {
  const now = options.now ?? Date.now();
  const clock = formatClock(date, options);
  const day = dayKey(date);
  if (day === dayKey(new Date(now))) return options.alwaysDay ? `${dayWord("Today", options)} ${clock}` : clock;
  if (day === dayKey(new Date(now - DAY_MS))) return `${dayWord("Yesterday", options)} ${clock}`;
  if (day === dayKey(new Date(now + DAY_MS))) return `${dayWord("Tomorrow", options)} ${clock}`;
  return `${formatDate(date, options)}, ${clock}`;
}

/**
 * A moment in UTC, as short as it can be while staying unambiguous, labelled:
 * "14:20 UTC" today, "Yesterday 14:20 UTC", "Tomorrow 14:20 UTC", else
 * "Oct 16, 14:20 UTC" ("Sep 15, 08:40:05 UTC" with `seconds`). With
 * `midSentence`, "yesterday 14:20 UTC".
 */
export function formatDateTime(value: string | number | Date | null | undefined, options: TimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${dateTimeText(date, options)} ${ZONE_LABEL}`;
}

/**
 * "2026-10-15 07:20 UTC" — for a `title` attribute, so the exact instant is one
 * hover away. `{ seconds: true }` gives "2026-10-15 07:20:05.123 UTC".
 */
export function utcTitle(
  value: string | number | Date | null | undefined,
  options: { seconds?: boolean } = {},
): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  return `${date.toISOString().slice(0, options.seconds ? 23 : 16).replace("T", " ")} UTC`;
}

/**
 * A recent moment, said the way a person would: "just now", "4 min ago",
 * "Today 14:20 UTC", else whatever `formatDateTime` says. For lists of live
 * things (a call still being checked), where a bare "01:35" reads as a timer.
 */
export function formatRelative(value: string | number | Date | null | undefined, options: TimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  const now = options.now ?? Date.now();
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes >= 0 && minutes < 1) return "just now";
  if (minutes >= 1 && minutes < 60) return `${minutes} min ago`;
  return formatDateTime(date, { ...options, alwaysDay: true });
}

/**
 * The UTC calendar day around `anchor`, as the half-open interval
 * `[00:00, next 00:00)` UTC — the same day boundary the "Today" / "Yesterday"
 * labels on rows use and the backend groups by, so a figure for "today" counts
 * exactly the rows labelled today. `offsetDays: -1` is yesterday.
 */
export function utcDayBounds(anchor: Date | number, options: { offsetDays?: number } = {}): { from: string; to: string } {
  const at = typeof anchor === "number" ? anchor : anchor.getTime();
  const day = Math.floor(at / DAY_MS) * DAY_MS + (options.offsetDays ?? 0) * DAY_MS;
  return { from: new Date(day).toISOString(), to: new Date(day + DAY_MS).toISOString() };
}

/**
 * The UTC day of a moment, for per-day groups: its key ("2026-10-16") and its
 * heading ("Today", "Yesterday", else "Oct 14") — the day the backend groups by.
 */
export function utcDay(value: string | number | Date, options: Pick<TimeOptions, "now"> = {}): { key: string; label: string } {
  const date = toDate(value) ?? new Date(0);
  const now = options.now ?? Date.now();
  const key = dayKey(date);
  if (key === dayKey(new Date(now))) return { key, label: "Today" };
  if (key === dayKey(new Date(now - DAY_MS))) return { key, label: "Yesterday" };
  return { key, label: formatDate(date, options) };
}
