import { humanize, plainAuditAction } from "@/libs/plain-language";

/**
 * Activity log (`/audit-log`), pure: one entry as a plain sentence, and the
 * entries grouped by day.
 *
 *   { actorType: "user", action: "spend_policy.updated", before: { dailyCap: "40.00" }, after: { dailyCap: "75.00" } }
 *   → title "Budget changed", line "You changed daily cap from 40.00 to 75.00"
 */

export interface AuditEntryLike {
  actorType: "user" | "agent" | "system" | "provider" | string;
  actorId: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shown(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") return UUID.test(value) || /^eip155:|^solana:/.test(value) ? null : value;
  if (Array.isArray(value)) return value.length === 0 ? "none" : `${value.length} ${value.length === 1 ? "item" : "items"}`;
  return null;
}

/** Who did it, in the reader's words. `me` is the signed-in person's email, when known. */
export function auditActor(entry: AuditEntryLike, agentName: (id: string) => string | null, me?: string | null): string {
  switch (entry.actorType) {
    case "user":
      if (!entry.actorId || (me && entry.actorId.toLowerCase() === me.toLowerCase())) return "You";
      return UUID.test(entry.actorId) ? "Someone on your team" : entry.actorId;
    case "agent":
      return (entry.actorId && agentName(entry.actorId)) || "One of your agents";
    case "system":
      return "Assay";
    case "provider":
      return "A provider";
    default:
      return "Someone";
  }
}

/** The changes, as phrases: "changed daily cap from 40.00 to 75.00", "set label to staging". */
export function auditChanges(entry: AuditEntryLike): string[] {
  const after = entry.after ?? {};
  const before = entry.before ?? {};
  const phrases: string[] = [];
  for (const [key, next] of Object.entries(after).slice(0, 3)) {
    const label = humanize(key).toLowerCase();
    const to = shown(next);
    if (to === null) continue;
    if (key in before && before[key] !== next) {
      const from = shown(before[key]);
      phrases.push(from === null ? `changed ${label} to ${to}` : `changed ${label} from ${from} to ${to}`);
    } else if (!(key in before)) {
      phrases.push(`set ${label} to ${to}`);
    }
  }
  return phrases;
}

export function auditSentence(
  entry: AuditEntryLike,
  agentName: (id: string) => string | null,
  me?: string | null,
): { title: string; line: string } {
  const actor = auditActor(entry, agentName, me);
  const changes = auditChanges(entry);
  return {
    title: plainAuditAction(entry.action),
    line: changes.length > 0 ? `${actor} ${changes.join(", and ")}` : `By ${actor === "You" ? "you" : actor}`,
  };
}

/** "Today", "Yesterday", or "Mon 13 Oct", in the reader's time zone. */
export function dayHeading(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Entries (newest first) grouped by local day, keeping order. */
export function groupByDay<T extends { createdAt: string }>(entries: readonly T[], now = new Date()): { day: string; entries: T[] }[] {
  const groups: { day: string; entries: T[] }[] = [];
  for (const entry of entries) {
    const day = dayHeading(entry.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}
