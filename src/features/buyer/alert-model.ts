import type { Money } from "@/interfaces";

/**
 * How an alert reads wherever it is shown — the bell, "See all alerts" and
 * Overview's Needs attention — so the three never disagree:
 *
 *  - `groupAlerts`: the same alert raised twice in one minute (two workers,
 *    one event) is one row, and dismissing it marks every copy read;
 *  - `readableBody`: a body is shown only when it is written for a person.
 *    Older notices said "Agent <uuid>", "PROVIDER_PER_AGENT_DAILY" and an ISO
 *    time; those keep their title and action and lose the line;
 *  - `isAlertResolved`: Needs attention leaves out an alert whose cause has
 *    cleared. Display only, and conservative: anything it cannot prove is
 *    over stays on screen;
 *  - `isOldLimitAlert`: a spend alert about a limit that has since changed
 *    says "(old limit)".
 */

export interface AlertNote {
  id: string;
  event: string;
  title: string;
  body?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  payload?: unknown;
  readAt?: string | null;
  createdAt: string;
}

export interface AlertGroup<T extends AlertNote> {
  /** The newest copy, the one drawn. */
  note: T;
  /** Every copy's id: what a dismiss marks read. */
  ids: string[];
  /** Unread while any copy is. */
  unread: boolean;
}

function groupKey(note: AlertNote): string {
  return `${note.event}|${note.subjectId ?? ""}|${note.title}|${String(note.createdAt).slice(0, 16)}`;
}

/** Copies folded into one row, in feed order (newest first). */
export function groupAlerts<T extends AlertNote>(items: readonly T[]): AlertGroup<T>[] {
  const groups = new Map<string, AlertGroup<T>>();
  for (const item of items) {
    const key = groupKey(item);
    const group = groups.get(key);
    if (group) {
      group.ids.push(item.id);
      group.unread ||= !item.readAt;
    } else {
      groups.set(key, { note: item, ids: [item.id], unread: !item.readAt });
    }
  }
  return [...groups.values()];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ENUM_CODE = /\b[A-Z]{2,}(?:_[A-Z]{2,})+\b/;
const RAW_UNITS = /\b\d+\.\d{5,}\b/;

/** The body when a person can read it; `null` when it carries an id, an enum code, an ISO time or raw units. */
export function readableBody(body: string | null | undefined): string | null {
  const text = body?.trim();
  if (!text) return null;
  if (UUID.test(text) || ISO_TIME.test(text) || ENUM_CODE.test(text) || RAW_UNITS.test(text)) return null;
  return text;
}

/**
 * The backend's default low-balance line (`BALANCE_LOW_THRESHOLD_MAJOR_UNITS`).
 * A balance at or above it is no longer low, so a low or zero balance alert
 * has cleared.
 */
export const LOW_BALANCE_CLEARED_MAJOR = 5;

export interface ResolvedContext {
  now: number;
  /** The balances as read now; `null` when unknown (then no balance alert is hidden). */
  balances: readonly { asset: string; decimals: number; available: Money }[] | null;
}

function payloadField(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

/** Whether the alert's cause is over. False whenever that cannot be shown. */
export function isAlertResolved(note: AlertNote, ctx: ResolvedContext): boolean {
  switch (note.event) {
    case "free_quota.exhausted": {
      // The free calls came back at the reset time the alert named.
      const resetsAt = payloadField(note.payload, "resetsAt");
      const at = typeof resetsAt === "string" ? Date.parse(resetsAt) : NaN;
      return Number.isFinite(at) && at <= ctx.now;
    }
    case "balance.low":
    case "balance.zero": {
      // Funded since: the same asset now holds at least the low-balance line.
      const asset = payloadField(note.payload, "asset");
      if (typeof asset !== "string" || !ctx.balances) return false;
      const balance = ctx.balances.find((b) => b.asset.toLowerCase() === asset.toLowerCase());
      if (!balance) return false;
      try {
        const line = BigInt(LOW_BALANCE_CLEARED_MAJOR) * 10n ** BigInt(balance.available.decimals);
        return BigInt(balance.available.amount) >= line;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export interface LimitContext {
  /** The policy `GET /spend-policy` answered, or `null` when unknown. */
  policy: { dailyCap: Money | null; monthlyCap: Money | null } | null;
  /** The agent that policy applies to; alerts about any other agent are not judged. */
  policyAgentId: string | null;
  /** That agent pays through an on-chain permission, whose per-24-hours limit replaced the older daily budget. */
  delegation: boolean;
}

/** A spend-band alert about a limit that no longer stands as it was. */
export function isOldLimitAlert(note: AlertNote, ctx: LimitContext): boolean {
  if (note.event !== "spend.threshold_crossed" || !ctx.policy || !ctx.policyAgentId) return false;
  if (note.subjectId !== ctx.policyAgentId) return false;
  const scope = payloadField(note.payload, "scope");
  const cap = payloadField(note.payload, "cap");
  const asset = payloadField(note.payload, "asset");
  if ((scope !== "daily" && scope !== "monthly") || typeof cap !== "string") return false;
  const current = scope === "daily" ? ctx.policy.dailyCap : ctx.policy.monthlyCap;
  if (!current || current.amount !== cap) return true;
  if (typeof asset === "string" && current.asset.toLowerCase() !== asset.toLowerCase()) return true;
  // The Assay-checked daily budget is an older rule once the agent has its own on-chain limit.
  return scope === "daily" && ctx.delegation;
}

/** The title as shown: "(old limit)" added when the alert is about a limit that has changed. */
export function alertTitle(title: string, oldLimit: boolean): string {
  return oldLimit ? `${title} (old limit)` : title;
}
