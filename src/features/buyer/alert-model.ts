import type { Money } from "@/interfaces";

/**
 * How an alert reads wherever it is shown — the bell, "See all alerts" and
 * Overview's Needs attention — so the three never disagree:
 *
 *  - `groupAlerts`: the same alert raised twice in one minute (two workers,
 *    one event) is one row, and dismissing it marks every copy read;
 *  - `readableBody`: the body in words a person reads. Older notices said
 *    "Agent <uuid>", "PROVIDER_PER_AGENT_DAILY", raw units and ISO times;
 *    only those tokens are rewritten, the rest of the body stays;
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

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CODE = "[A-Z]{2,}(?:_[A-Z]{2,})+";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Oct 14, 00:00 UTC`, the way notices write a time. */
function noticeTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}

/**
 * The body in words a person reads. Only the offending token is rewritten or
 * dropped, never the whole body, so an amount, a deadline or a reassurance
 * ("No balance was affected") stays:
 *
 *  - "Agent <id>" becomes "Your agent"; any other id becomes "it";
 *  - an ISO time becomes "Oct 14, 00:00 UTC";
 *  - raw units ("4.900000 USDC") become dollars ("$4.90"), cut, never rounded up;
 *  - an enum code is dropped ("(TOOL_NOT_ALLOWED)", "its PROVIDER_…_DAILY limit" → "its limit");
 *  - a quoted name ("CI_DEPLOY") is the person's own label and is left as it is.
 *
 * `null` when nothing is left to read.
 */
export function readableBody(body: string | null | undefined): string | null {
  const text = body?.trim();
  if (!text) return null;
  // Set quoted names aside, so a label like "PROD_BOT" is never read as a code.
  const quoted: string[] = [];
  let out = text.replace(/"[^"]*"/g, (match) => `\u0000${quoted.push(match) - 1}\u0000`);
  out = out
    .replace(new RegExp(`\\bAgent\\s+${UUID}`, "gi"), "Your agent")
    .replace(new RegExp(`\\bfor\\s+${UUID}`, "gi"), "for a tool")
    .replace(new RegExp(UUID, "gi"), "it")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, (iso) => noticeTime(iso))
    .replace(/\b(\d+)\.(\d{5,})\b(?:\s+[A-Z]{2,6}\b(?!_))?/g, (_m, whole: string, fraction: string) => `$${whole}.${fraction.slice(0, 2)}`)
    .replace(new RegExp(`\\s*\\(\\s*${CODE}\\s*\\)`, "g"), "")
    .replace(new RegExp(`\\b(its|the|a)\\s+${CODE}\\s+`, "g"), "$1 ")
    .replace(new RegExp(`\\b${CODE}\\b`, "g"), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:)])/g, "$1")
    .trim();
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => quoted[Number(i)] ?? "");
  return /[a-z]/i.test(out) ? out : null;
}

export interface ResolvedContext {
  now: number;
  /** The balances as read now; `null` when unknown (then no balance alert is hidden). */
  balances: readonly { asset: string; available: Money }[] | null;
}

function payloadField(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

/** The end of the UTC day `iso` falls in, in ms. */
function utcDayEnd(iso: string): number {
  const at = new Date(iso);
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
}

/** Whether the alert's cause is over. False whenever that cannot be shown. */
export function isAlertResolved(note: AlertNote, ctx: ResolvedContext): boolean {
  switch (note.event) {
    case "free_quota.exhausted": {
      // A daily limit only: its reset is the end of the alert's UTC day, the
      // same day the once-a-day alert covers, so a second hit after the reset
      // raises a new alert. The per-minute limit resets within the same day
      // (a repeat would raise nothing), so it is never hidden.
      if (payloadField(note.payload, "limit") === "PLATFORM_RATE_LIMIT") return false;
      const resetsAt = payloadField(note.payload, "resetsAt");
      const at = typeof resetsAt === "string" ? Date.parse(resetsAt) : NaN;
      return Number.isFinite(at) && at >= utcDayEnd(note.createdAt) && at <= ctx.now;
    }
    case "balance.low":
    case "balance.zero": {
      // Funded since: the same asset is back at or above the line the alert
      // was raised against (`payload.threshold`). No threshold, no hiding.
      const asset = payloadField(note.payload, "asset");
      const threshold = payloadField(note.payload, "threshold");
      if (typeof asset !== "string" || typeof threshold !== "string" || !ctx.balances) return false;
      const balance = ctx.balances.find((b) => b.asset.toLowerCase() === asset.toLowerCase());
      if (!balance) return false;
      try {
        return BigInt(balance.available.amount) >= BigInt(threshold);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Alerts about a risk that is still open until the person acts: a balance at
 * or near zero, a key expiring or expired, a withdrawal pending. Opening "See
 * all alerts" does not mark these read; they leave Needs attention only by
 * Dismiss, or when the condition clears.
 */
export const OPEN_RISK_EVENTS: ReadonlySet<string> = new Set([
  "balance.zero",
  "balance.low",
  "session.expiring",
  "session.expired",
  "withdrawal.initiated",
]);

/** Most attempts at marking one alert read before giving up for this visit. */
export const MARK_READ_ATTEMPTS = 2;

/**
 * What opening "See all alerts" marks read: the unread copies shown, except
 * open risks, and only ids not yet tried `MARK_READ_ATTEMPTS` times — so a
 * re-render never sends the same request again, and a failure is retried once.
 */
export function idsToMarkOnOpen(groups: readonly AlertGroup<AlertNote>[], attempts: ReadonlyMap<string, number>): string[] {
  return groups
    .filter((group) => group.unread && !OPEN_RISK_EVENTS.has(group.note.event))
    .flatMap((group) => group.ids)
    .filter((id) => (attempts.get(id) ?? 0) < MARK_READ_ATTEMPTS);
}

export interface AttentionRows<T extends AlertNote> {
  /** The rows drawn, newest first. */
  shown: AlertGroup<T>[];
  /** "3 items", or "5+ items" when the unread list was not read to its end. */
  countLabel: string;
  /** Unread alerts may exist beyond what was read: never say "Nothing needs your attention". */
  more: boolean;
}

/**
 * Needs attention's rows: unread copies not dismissed, folded, with cleared
 * ones left out. `complete` is whether the unread list was read to its end.
 */
export function attentionRows<T extends AlertNote>(
  notes: readonly T[],
  ctx: ResolvedContext & { dismissed: ReadonlySet<string>; complete: boolean; shown: number },
): AttentionRows<T> {
  const groups = groupAlerts(notes.filter((note) => !note.readAt && !ctx.dismissed.has(note.id))).filter(
    (group) => !isAlertResolved(group.note, ctx),
  );
  const shown = groups.slice(0, ctx.shown);
  const more = !ctx.complete || groups.length > ctx.shown;
  const total = ctx.complete ? groups.length : Math.max(groups.length, ctx.shown);
  const countLabel = more && !ctx.complete ? `${total}+ items` : total === 1 ? "1 item" : `${total} items`;
  return { shown, countLabel, more };
}

export interface LimitContext {
  /** The policy `GET /spend-policy` answered; `null` = there is none (removed); `undefined` = unknown. */
  policy: { dailyCap: Money | null; monthlyCap: Money | null } | null | undefined;
  /** The agent that policy applies to; alerts about any other agent are not judged. */
  policyAgentId: string | null;
  /** That agent pays through an on-chain permission, whose per-24-hours limit replaced the older daily budget. */
  delegation: boolean;
}

/** A spend-band alert about a limit that no longer stands as it was. */
export function isOldLimitAlert(note: AlertNote, ctx: LimitContext): boolean {
  if (note.event !== "spend.threshold_crossed" || ctx.policy === undefined || !ctx.policyAgentId) return false;
  if (note.subjectId !== ctx.policyAgentId) return false;
  // No policy any more: every limit an alert named has been removed.
  if (ctx.policy === null) return true;
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
