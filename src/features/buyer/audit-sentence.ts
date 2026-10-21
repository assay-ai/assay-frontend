import Decimal from "decimal.js";

import { reasonLabel } from "@/features/call-disputes/model";
import { humanize, plainAuditAction } from "@/libs/plain-language";
import { formatDateTime } from "@/libs/utc-time";
import { formatMoney } from "@/utils/money";

/**
 * Account history (`/audit-log`), pure: one entry as a plain sentence, and the
 * entries grouped by day.
 *
 * Sentences are "You …", past tense, in the product's words ("tool set",
 * never "Toolset"), and never print a raw id, an enum or a list of ids.
 *
 *   { actorType: "user", action: "spend_policy.updated", before: { dailyCap: "40.00" }, after: { dailyCap: "75.00" } }
 *   → title "Spending limits changed", line "You changed daily spending limit from $40.00 to $75.00"
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
const RAW_VALUE = /^(eip155:|solana:|assay_|sk_|pk_|cred_|ses_|aud_|dep_|sp_|hld_)|^0x[0-9a-f]{6,}$/i;

/** An email address: said only as the actor's name, never inside a change. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field names whose values are money in major units. */
const MONEY_KEY = /(cap|limit|amount|budget|charged|price|balance)$/i;

/**
 * Money fields the backend writes in minor units ("400000" is $0.40 at six
 * decimals): spending limits and the on-chain permission's caps. A value with a
 * decimal point is already in major units and is left to MONEY_KEY.
 */
const MINOR_MONEY_KEY = /^(perCallMax|dailyCap|monthlyCap|maxSpendPerHour|requireApprovalAbove|maxPerWindow|maxVoucherAmount)$/;
const MINOR_DECIMALS = 6;

/** Bookkeeping fields of a policy version: never part of a sentence a person would say. */
const HIDDEN_KEY = /^(policyVersion|changeReason|changedBy|transactionHash)$/;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Field names said in the product's words rather than humanized. */
const KEY_WORDS: Record<string, string> = {
  dailyCap: "daily spending limit",
  monthlyCap: "monthly spending limit",
  perCallCap: "per-call limit",
  maxCallsPerMinute: "calls per minute limit",
  revokedAt: "revoked",
};

function shown(value: unknown, key = ""): string | null {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (MINOR_MONEY_KEY.test(key) && /^\d+$/.test(String(value))) {
    return formatMoney({ amount: String(value), asset: "", decimals: MINOR_DECIMALS }, { decimals: MINOR_DECIMALS });
  }
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") {
    if (UUID.test(value) || RAW_VALUE.test(value) || EMAIL.test(value)) return null;
    if (ISO_TIME.test(value)) return formatDateTime(value);
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
      // An account is one person (owner decision D3), and the backend names a
      // signed-in person by the credential of their session, not their email:
      // a "user" entry is the reader. Only an email that is not theirs is named.
      if (entry.actorId && EMAIL.test(entry.actorId) && (!me || entry.actorId.toLowerCase() !== me.toLowerCase())) {
        return entry.actorId;
      }
      return "You";
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
  const fields = Object.entries(after).filter(([key]) => !HIDDEN_KEY.test(key) && !/Ids?$|_ids?$/.test(key));
  for (const [key, next] of fields.slice(0, 3)) {
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

function count(value: unknown, noun: string): string | null {
  if (!Array.isArray(value) && typeof value !== "number") return null;
  const n = Array.isArray(value) ? value.length : value;
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}

/** "the tool set “Research”", or "a tool set" when the entry does not carry its name. */
function toolsetName(...values: unknown[]): string {
  const name = values.map(text).find((value) => value !== null);
  return name ? `the tool set “${name}”` : "a tool set";
}

function dollars(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) return null;
  // "25.000000" (an amount at the asset's full scale) reads "$25.00"; a sub-cent price keeps its digits.
  const amount = new Decimal(value);
  return `$${amount.toFixed(Math.max(2, amount.decimalPlaces()))}`;
}

/**
 * Entries whose generic "changed X from A to B" reading would be system talk
 * ("Assay changed charged from 6.00 to 0.00", "set credential to assay_sk_live_…").
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
    case "agent.renamed": {
      const from = text(before.label);
      const to = text(after.label);
      return {
        title: "Agent renamed",
        line: to ? `${subject} renamed ${from ? `the agent “${from}”` : "an agent"} to “${to}”` : `${subject} renamed an agent`,
      };
    }
    case "deposit.rejected": {
      const amount = dollars(after.amount);
      return {
        title: amount ? `Deposit: ${amount} not credited` : "Deposit not credited",
        line: "The chain dropped the deposit's transaction, so nothing was added to your balance",
      };
    }
    case "withdrawal.requested": {
      const amount = dollars(after.amount);
      return {
        title: amount ? `Withdrawal: ${amount} requested` : "Withdrawal requested",
        line: `${subject} asked to withdraw ${amount ? `up to ${amount}` : "money"} from the escrow; paid calls on that chain pause until it is claimed or cancelled`,
      };
    }
    case "withdrawal.cancelled":
      return {
        title: "Withdrawal cancelled",
        line: `${subject} cancelled the withdrawal request; nothing left the escrow and paid calls can resume`,
      };
    case "withdrawal.claimed": {
      const amount = dollars(after.amount);
      return {
        title: amount ? `Withdrawal: ${amount} claimed` : "Withdrawal claimed",
        line: `${amount ?? "The money"} left the escrow for your wallet`,
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
    case "call_dispute.filed": {
      const reason = text(after.reason);
      const window =
        after.refundGuaranteed === true
          ? "; reported within the refund window"
          : after.refundGuaranteed === false
            ? "; reported after the refund window, so a refund is not guaranteed"
            : "";
      return {
        title: "Bad result reported",
        line: `${subject} reported a bad result on a call${reason ? ` (reason: ${reasonLabel(reason, humanize(reason)).toLowerCase()})` : ""}${window}`,
      };
    }
    case "call_dispute.withdrawn":
      return { title: "Report withdrawn", line: `${subject} withdrew a report of a bad result` };
    case "call_dispute.responded":
      return { title: "Provider replied", line: "The provider replied to a report of a bad result" };
    case "toolset.created": {
      const tools = count(after.toolCount, "tool");
      return {
        title: "Tool set created",
        line: `${subject} created ${toolsetName(after.name, after.slug)}${tools ? ` with ${tools}` : ""}`,
      };
    }
    case "toolset.updated": {
      const from = text(before.name);
      const to = text(after.name);
      if (to && from !== to) {
        return { title: "Tool set renamed", line: `${subject} renamed ${toolsetName(from)} to “${to}”` };
      }
      return { title: "Tool set changed", line: `${subject} changed the settings of ${toolsetName(from)}` };
    }
    case "toolset.entries_replaced": {
      const tools = count(after.toolIds, "tool");
      return {
        title: "Tool set tools changed",
        line: `${subject} changed which tools are in a tool set${tools ? `; it now has ${tools}` : ""}`,
      };
    }
    case "toolset.deleted":
      return { title: "Tool set deleted", line: `${subject} deleted ${toolsetName(before.name, before.slug)}` };
    case "toolset.published": {
      const version = typeof after.latestVersion === "number" ? ` as version ${after.latestVersion}` : "";
      return { title: "Tool set published", line: `${subject} published a tool set${version}` };
    }
    case "toolset.copied":
      return { title: "Tool set copied", line: `${subject} copied a tool set into your own` };
    case "credential.access_updated":
      return { title: "Agent's tools changed", line: `${subject} changed which tools an agent key can use` };
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
    // The backend's action names say "toolset"; the product says "tool set".
    title: plainAuditAction(entry.action).replace(/\btoolset\b/gi, (word) => (word[0] === "T" ? "Tool set" : "tool set")),
    line: changes.length > 0 ? `${actor} ${changes.join(", and ")}` : `By ${actor === "You" ? "you" : actor}`,
  };
}

/** "Today", "Yesterday", or "Mon 13 Oct" — the UTC day, the one the backend groups by. */
export function dayHeading(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOf = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  const days = startOf(now) - startOf(date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}),
  });
}

/** Entries (newest first) grouped by UTC day, keeping order. */
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
