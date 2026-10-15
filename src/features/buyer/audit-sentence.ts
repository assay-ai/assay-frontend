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

/** Values that are identifiers or secrets, never body text: ids, chain ids, key prefixes, hashes. */
const RAW_VALUE = /^(eip155:|solana:|x402_|sk_|pk_|cred_|ses_|aud_|dep_|sp_|hld_)|^0x[0-9a-f]{6,}$/i;

/** An email address: said only as the actor's name, never inside a change. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field names whose values are money in major units. */
const MONEY_KEY = /(cap|limit|amount|budget|charged|price|balance)$/i;

/** Field names said in the product's words rather than humanized. */
const KEY_WORDS: Record<string, string> = {
  dailyCap: "daily budget",
  monthlyCap: "monthly budget",
  perCallCap: "per-call limit",
  maxCallsPerMinute: "calls per minute limit",
  revokedAt: "revoked",
};

function shown(value: unknown, key = ""): string | null {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") {
    if (UUID.test(value) || RAW_VALUE.test(value) || EMAIL.test(value)) return null;
    if (MONEY_KEY.test(key) && /^\d+(\.\d+)?$/.test(value)) return `$${value}`;
    return value;
  }
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
    if (/Id$|_id$/.test(key)) continue;
    const label = KEY_WORDS[key] ?? humanize(key).toLowerCase();
    const to = shown(next, key);
    if (to === null) continue;
    if (key in before && before[key] !== next) {
      const from = shown(before[key], key);
      phrases.push(from === null ? `changed ${label} to ${to}` : `changed ${label} from ${from} to ${to}`);
    } else if (!(key in before)) {
      phrases.push(`set ${label} to ${to}`);
    }
  }
  return phrases;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" && !UUID.test(value) && !RAW_VALUE.test(value) && !EMAIL.test(value)
    ? value
    : null;
}

function dollars(value: unknown): string | null {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? `$${value}` : null;
}

/**
 * Entries whose generic "changed X from A to B" reading would be system talk
 * ("Assay changed charged from 6.00 to 0.00", "set credential to x402_live_…").
 * Each gets the sentence a person would say.
 */
function specific(
  entry: AuditEntryLike,
  actor: string,
): { title: string; line: string } | null {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const subject = actor === "You" ? "You" : actor;
  switch (entry.action) {
    case "session.created":
      return entry.actorType === "agent"
        ? { title: "Agent connected", line: `${subject} connected to Assay with its agent key` }
        : { title: "Signed in", line: actor === "You" ? "You signed in" : `${subject} signed in` };
    case "payment_intent.refunded":
    case "payment_intent.voided":
    case "payment_intent.expired": {
      const amount = dollars(before.charged) ?? dollars(before.amount) ?? dollars(after.amount);
      const why =
        entry.action === "payment_intent.refunded"
          ? "A call failed our checks"
          : entry.action === "payment_intent.voided"
            ? "A call got no usable result"
            : "A call did not finish in time";
      return {
        title: amount ? `Refund: ${amount} not charged` : "Refund: call not charged",
        line: `${why}, so ${amount ? `the ${amount}` : "the amount"} held for it went back to your balance`,
      };
    }
    case "deposit.credited": {
      const amount = dollars(after.amount);
      return {
        title: amount ? `Deposit: ${amount} added` : "Deposit added",
        line: "Your deposit reached your balance and can pay for calls",
      };
    }
    case "credential.created": {
      const name = text(after.name) ?? text(after.label);
      return { title: "Agent key created", line: `${subject} created ${name ? `the agent key “${name}”` : "an agent key"}` };
    }
    case "credential.revoked": {
      const name = text(after.name) ?? text(before.name);
      return {
        title: "Agent key revoked",
        line: `${subject} revoked ${name ? `the agent key “${name}”` : "an agent key"}; it stopped working immediately`,
      };
    }
    case "agent.created": {
      const name = text(after.label) ?? text(after.name);
      return { title: "Agent added", line: `${subject} added ${name ? `the agent “${name}”` : "an agent"}` };
    }
    default:
      return null;
  }
}

export function auditSentence(
  entry: AuditEntryLike,
  agentName: (id: string) => string | null,
  me?: string | null,
): { title: string; line: string } {
  const actor = auditActor(entry, agentName, me);
  const special = specific(entry, actor);
  if (special) return special;
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
