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

/**
 * A moment, as short as it can be while staying unambiguous:
 * "14:20" today, "Yesterday 14:20", "Tomorrow 14:20", else "Oct 16, 14:20".
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
  if (day === dayKey(new Date(now), options.timeZone)) return clock;
  if (day === dayKey(new Date(now - 86_400_000), options.timeZone)) return `Yesterday ${clock}`;
  if (day === dayKey(new Date(now + 86_400_000), options.timeZone)) return `Tomorrow ${clock}`;
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
  return dayKey(date, options.timeZone) === dayKey(new Date(now), options.timeZone) ? `Today ${text}` : text;
}
