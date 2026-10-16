/**
 * Times for people: in their own time zone, at the coarsest precision that
 * still answers the question, with the exact UTC instant one hover away.
 *
 * Use `formatLocalDateTime` for a moment ("14:20", "Yesterday 09:05",
 * "Oct 16, 14:20"), `formatLocalDate` for a day, and `utcTitle` as the `title`
 * of the element that shows either — `<LocalTime>` in
 * components/patterns/local-time.tsx does all three.
 *
 * Every function takes an optional `timeZone` and `now`, so tests are not at
 * the mercy of the machine's clock or zone. Screens leave both out.
 */

export interface LocalTimeOptions {
  /** IANA zone. Defaults to the browser's own. */
  timeZone?: string;
  /** Add seconds ("14:20:07") — for a step-by-step timeline. Off by default. */
  seconds?: boolean;
  /** "Now", for relative labels. Defaults to Date.now(). */
  now?: number;
  /** "Today 14:20" rather than a bare "14:20", where a time alone could be any day (a timeline, a deadline). */
  alwaysDay?: boolean;
  /**
   * The time sits inside running text ("asked today 04:06", "sign before
   * tomorrow 19:06"): the day words are lowercase. Off by default, for a time
   * that stands alone or starts a sentence ("Today 14:20").
   */
  midSentence?: boolean;
}

const LOCALE = "en-US";

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar parts of a date in a zone: used to compare "same day". */
function dayKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "14:20" — 24-hour clock, the format the design uses everywhere. */
export function formatClock(value: string | number | Date | null | undefined, options: LocalTimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: options.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  }).format(date);
}

/** "Oct 16" (this year) or "Oct 16, 2025". */
export function formatLocalDate(value: string | number | Date | null | undefined, options: LocalTimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  const now = new Date(options.now ?? Date.now());
  const sameYear =
    new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone, year: "numeric" }).format(date) ===
    new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone, year: "numeric" }).format(now);
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: options.timeZone,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** "Today" / "today", as the position in the sentence wants it. */
function dayWord(word: "Today" | "Yesterday" | "Tomorrow", options: LocalTimeOptions): string {
  return options.midSentence ? word.toLowerCase() : word;
}

/**
 * A moment, as short as it can be while staying unambiguous:
 * "14:20" today, "Yesterday 14:20", "Tomorrow 14:20", else "Oct 16, 14:20".
 * With `midSentence`, "yesterday 14:20" — for a time inside a sentence.
 */
export function formatLocalDateTime(
  value: string | number | Date | null | undefined,
  options: LocalTimeOptions = {},
): string {
  const date = toDate(value);
  if (!date) return "—";
  const now = options.now ?? Date.now();
  const clock = formatClock(date, options);
  const day = dayKey(date, options.timeZone);
  if (day === dayKey(new Date(now), options.timeZone)) return options.alwaysDay ? `${dayWord("Today", options)} ${clock}` : clock;
  if (day === dayKey(new Date(now - 86_400_000), options.timeZone)) return `${dayWord("Yesterday", options)} ${clock}`;
  if (day === dayKey(new Date(now + 86_400_000), options.timeZone)) return `${dayWord("Tomorrow", options)} ${clock}`;
  return `${formatLocalDate(date, options)}, ${clock}`;
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
 * The zone a local time is shown in, as a short label ("GMT+1", "PDT") — put
 * next to a deadline so nobody wonders whose afternoon it is.
 */
export function zoneLabel(value: string | number | Date | null | undefined, options: { timeZone?: string } = {}): string {
  const date = toDate(value) ?? new Date();
  const part = new Intl.DateTimeFormat(LOCALE, { timeZone: options.timeZone, timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/**
 * A recent moment, said the way a person would: "just now", "4 min ago",
 * "Today 14:20", else whatever `formatLocalDateTime` says. For lists of live
 * things (a call still being checked), where a bare "01:35" reads as a timer.
 */
export function formatRelative(value: string | number | Date | null | undefined, options: LocalTimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return "—";
  const now = options.now ?? Date.now();
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes >= 0 && minutes < 1) return "just now";
  if (minutes >= 1 && minutes < 60) return `${minutes} min ago`;
  const text = formatLocalDateTime(date, options);
  return dayKey(date, options.timeZone) === dayKey(new Date(now), options.timeZone) ? `${dayWord("Today", options)} ${text}` : text;
}

/** The wall clock of an instant in a zone, read back as if it were UTC: its offset is the difference. */
function wallClockAsUtc(ms: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

/** The instant of 00:00 on a calendar day (UTC-based y/m/d) in a zone, DST included. */
function zoneMidnight(utcDay: number, timeZone?: string): number {
  let guess = utcDay - (wallClockAsUtc(utcDay, timeZone) - utcDay);
  // Once more at the guess itself, so a day that starts on the other side of a DST change lands right.
  guess = utcDay - (wallClockAsUtc(guess, timeZone) - guess);
  return guess;
}

/**
 * The reader's calendar day around `anchor`, as the half-open interval
 * `[00:00, next 00:00)` in their zone — the same day boundary the "Today" /
 * "Yesterday" labels on rows use, so a figure for "today" counts exactly the
 * rows labelled today (review 2026-10-17 P3). `offsetDays: -1` is yesterday.
 */
export function localDayBounds(
  anchor: Date | number,
  options: { timeZone?: string; offsetDays?: number } = {},
): { from: string; to: string } {
  const at = typeof anchor === "number" ? anchor : anchor.getTime();
  const [y, m, d] = dayKey(new Date(at), options.timeZone).split("-").map(Number);
  const day = Date.UTC(y, m - 1, d + (options.offsetDays ?? 0));
  return {
    from: new Date(zoneMidnight(day, options.timeZone)).toISOString(),
    to: new Date(zoneMidnight(day + 86_400_000, options.timeZone)).toISOString(),
  };
}
