import { penaltyMoney } from "@/features/provider-penalties/money";
import { splitPenalty } from "@/features/provider-slash-case/distribution";
import type { Money } from "@/interfaces";
import { plainRuleCode } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { formatDateTime } from "@/libs/utc-time";
import { formatMoney } from "@/utils/money";

/**
 * A provider notice in the provider's words, rendered from its `event` and
 * `payload` — never from the stored title and body, which older rows wrote in
 * minor units ("40000 was taken from your stake"), binding ids and ISO
 * timestamps. Because the words are built here, every stored row reads the
 * same as a new one. Events this table does not know keep their stored text.
 */

export interface NoticeSource {
  event: string;
  title: string;
  body: string;
  subjectType?: string | null;
  subjectId?: string | null;
  payload?: unknown;
  createdAt: string;
}

export interface NoticeContext {
  /** The tool a binding serves, by name; null when unknown (never an id or a host). */
  toolName: (bindingId: string | null | undefined) => string | null;
  /** Clock, for "tomorrow 14:23 UTC" and for deadlines already past; injectable for tests. */
  now?: number;
}

export interface NoticeView {
  title: string;
  body: string;
  /** Its own next step; null to fall back to the subject's page. */
  target: { href: string; label: string } | null;
  /**
   * Notices with the same key say the same thing again (the daily headroom
   * warning, a window's repeated warnings, a run of cancellations for one
   * reason) and are shown once; null = never grouped.
   */
  groupKey: string | null;
}

/** The platform settles in 6-decimal stablecoins; rows written before `decimals` was in the payload. */
const DEFAULT_DECIMALS = 6;
/** The backend's `STAKE_HEADROOM_WARNING_RATIO` (20%), for rows written before `margin` was in the payload. */
const HEADROOM_PERCENT = 20n;
/** The backend's grace period, for rows written before `graceDays` was in the payload. */
const DEFAULT_GRACE_DAYS = 7;
/** The provider's one reply is accepted for 24 h after filing (`CALL_DISPUTE_SLA.providerReplyMs`). */
const REPLY_WINDOW_MS = 24 * 3_600_000;

type Payload = Record<string, unknown>;

function payloadOf(item: NoticeSource): Payload {
  return item.payload && typeof item.payload === "object" ? (item.payload as Payload) : {};
}

function text(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function number(payload: Payload, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A minor-unit amount from the payload, as `Money`; null when absent or not an integer. */
function amount(payload: Payload, key: string): Money | null {
  const raw = payload[key];
  const value = typeof raw === "number" ? String(raw) : raw;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const decimals = number(payload, "decimals") ?? DEFAULT_DECIMALS;
  return { amount: value, asset: "", decimals };
}

/** "1.6%" — one decimal under 10%, none above (the Needs-action wording). */
function pct(rate: number): string {
  const value = rate * 100;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}%`;
}

function when(value: string | null, ctx: NoticeContext): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return formatDateTime(value, { now: ctx.now, alwaysDay: true, midSentence: true });
}

const on = (tool: string | null) => (tool ? ` on ${tool}` : "");

/** Why a proposed penalty was cancelled, in plain words, from what the payload records. */
function cancelReason(payload: Payload): { key: string; sentence: string } {
  const kind = text(payload, "resolutionKind");
  if (kind === "CHAIN_ARBITER") return { key: "arbiter", sentence: "The arbiter ruled for you on chain." };
  if (payload.overturned === true) return { key: "overturned", sentence: "Your dispute was accepted." };
  return {
    key: "chain",
    sentence: "The chain did not accept it (it expired or was refused there), so it was cancelled.",
  };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const minor = (amount: string, decimals: number): string => penaltyMoney({ amount, asset: "", decimals });

/**
 * The guard for stored text, which is shown only for events this table does
 * not render or for a row whose payload lacks a field. Some producers still
 * write minor units, asset ids, ids and ISO times into the text, and the rule
 * "no raw units, ids or 6-decimal figures in a provider notice" must not
 * depend on every payload being well-formed.
 */
export function sanitizeStoredText(
  value: string,
  ctx: Pick<NoticeContext, "now"> = {},
  /** The payload's `decimals` when it has one. Stored text never states its scale; the platform's stablecoins are 6. */
  decimals: number = DEFAULT_DECIMALS,
): string {
  const MINOR = (amount: string) => minor(amount, decimals);
  return (
    value
      // "28470000 solana:…/token:…": minor units with their asset id.
      .replace(/(\d{1,30}) ([a-z0-9-]+:[^\s/]+\/[^\s]+?)(?=[\s,.;)]|$)/gi, (_m, amount: string) => MINOR(amount))
      // "A penalty of 28470000", "stands at 40000", "40000 was taken": minor units by context.
      .replace(/\b(penalty of |stands at |amount of )(\d{4,30})\b(?![.:/])/gi, (_m, lead: string, amount: string) => `${lead}${MINOR(amount)}`)
      .replace(/^(\d{4,30})(?= (?:was|is|were) )/i, (_m, amount: string) => MINOR(amount))
      // "100.000000": a figure written at the asset's full scale (`MoneyUtil.format`).
      // Only a fraction exactly `decimals` long is taken for one.
      .replace(
        decimals >= 1 ? new RegExp(`\\b(\\d{1,30})\\.(\\d{${decimals}})\\b`, "g") : /(?!)/g,
        (_m, whole: string, fraction: string) => MINOR(`${whole}${fraction}`),
      )
      // Ids: a binding or a tool is "one of your tools"; an agent is "an agent".
      .replace(new RegExp(`\\b(?:binding|tool) ${UUID}`, "gi"), "One of your tools")
      .replace(new RegExp(`\\bagent:? ${UUID}`, "gi"), "an agent")
      .replace(new RegExp(UUID, "gi"), "(id on the linked page)")
      // ISO times.
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g, (iso) =>
        formatDateTime(iso, { now: ctx.now, alwaysDay: true, midSentence: true }),
      )
  );
}

export function noticeView(item: NoticeSource, ctx: NoticeContext): NoticeView {
  const p = payloadOf(item);
  const stored: NoticeView = {
    title: sanitizeStoredText(item.title, ctx, number(p, "decimals") ?? DEFAULT_DECIMALS),
    body: sanitizeStoredText(item.body, ctx, number(p, "decimals") ?? DEFAULT_DECIMALS),
    target: null,
    groupKey: null,
  };
  const bindingId = text(p, "bindingId") ?? (item.subjectType === "binding" ? (item.subjectId ?? null) : null);
  const tool = text(p, "toolName") ?? ctx.toolName(bindingId);
  const addStake = { href: routes.stake("stake"), label: "Add stake" };
  const graceDays = number(p, "graceDays") ?? DEFAULT_GRACE_DAYS;
  const grace = `${graceDays} day${graceDays === 1 ? "" : "s"}`;

  switch (item.event) {
    case "provider.slash_proposed": {
      const penalty = amount(p, "penaltyAmount");
      const from = when(text(p, "earliestExecutionAt"), ctx);
      return {
        // "Up to": the proposed figure is uncapped; the penalty page leads with what the chain reserved.
        title: `${penalty ? `A penalty of up to ${penaltyMoney(penalty)}` : "A penalty"}${on(tool)} is proposed against your stake`,
        body:
          `${from ? `Nothing is taken before ${from}. ` : ""}Open the penalty to see the measurement and the deadline to dispute it. ` +
          "Your tools keep taking calls, and earnings already paid are not touched.",
        target: null,
        groupKey: null,
      };
    }

    case "provider.slash_executed": {
      const applied = amount(p, "applied");
      if (!applied) return stored;
      const split = splitPenalty(applied);
      return {
        title: `${penaltyMoney(applied)} penalty${on(tool)} was executed`,
        body:
          `You lost ${penaltyMoney(split.taken)} of your stake: ${penaltyMoney(split.agent)} to the buyers whose calls failed ` +
          `and ${penaltyMoney(split.platform)} to Assay. The other ${penaltyMoney(split.neverTaken)} is never taken.`,
        target: null,
        groupKey: null,
      };
    }

    case "provider.slash_reversed": {
      const restored = amount(p, "restored");
      if (!restored) return stored;
      return {
        title: `${penaltyMoney(restored)} was returned to your stake${tool ? ` (penalty on ${tool})` : ""}`,
        body: "A penalty taken from your stake was reversed. The penalty page lists what was restored.",
        target: null,
        groupKey: null,
      };
    }

    case "provider.slash_decided": {
      const penalty = amount(p, "penaltyAmount");
      const head = `${penalty ? `${penaltyMoney(penalty)} penalty` : "A proposed penalty"}${on(tool)}`;
      if (p.overturned === false) {
        return {
          title: `${head} was upheld`,
          body: "Your dispute was not accepted. The penalty page shows when it can be taken from your stake.",
          target: null,
          groupKey: null,
        };
      }
      const reason = cancelReason(p);
      const held = when(text(p, "reservationHeldUntil"), ctx);
      return {
        title: `${head} was cancelled: nothing was taken`,
        body:
          `${reason.sentence} ` +
          (held
            ? `The stake it reserved stays reserved until ${held}, but nothing can be taken from it.`
            : "Any stake it reserved is free again."),
        target: null,
        // Folded only with the same reason on the same tool: an arbiter win
        // never merges with a chain refusal, nor one tool's run with another's.
        groupKey: `slash-cancelled:${reason.key}:${held ? "held" : "free"}:${tool ?? ""}`,
      };
    }

    case "provider.sla_breach_proposed": {
      const rate = number(p, "observedRate");
      const limit = number(p, "effectiveThreshold");
      const calls = number(p, "verifiedCalls");
      const penalty = amount(p, "penaltyAmount");
      return {
        title: `${tool ?? "Your tool"}: a check window closed over your promise`,
        body:
          (rate !== null && calls !== null
            ? `${pct(rate)} of ${calls.toLocaleString("en-US")} checked calls failed${limit !== null ? `; the limit was ${pct(limit)}` : ""}. `
            : "") +
          (penalty
            ? `A penalty of up to ${penaltyMoney(penalty)} is proposed; your stake limits apply when it is filed.`
            : "A penalty is proposed."),
        target: bindingId ? { href: routes.binding(bindingId, "quality"), label: "See quality" } : null,
        groupKey: null,
      };
    }

    case "provider.sla_window_warning": {
      const rate = number(p, "observedFailureRate");
      const promise = number(p, "declaredFailureRate");
      const checked = number(p, "verifiedCalls");
      const remaining = number(p, "callsRemaining");
      const rule = text(p, "topFailingRule");
      if (rate === null || promise === null) return stored;
      const over = rate > promise;
      return {
        title: `${tool ?? "Your tool"}: ${pct(rate)} of calls failed in a check window, ${over ? "over" : "near"} your ${pct(promise)} promise`,
        body:
          (checked !== null
            ? `${checked.toLocaleString("en-US")} of about ${(checked + (remaining ?? 0)).toLocaleString("en-US")} calls checked when this was sent. `
            : "") +
          (rule ? `Most failures: ${plainRuleCode(rule).replace(/\.$/, "")}. ` : "") +
          "The Quality tab shows whether a penalty is possible yet.",
        target: bindingId ? { href: routes.binding(bindingId, "quality"), label: "See quality" } : null,
        // One per window: the warning is re-sent as the window fills.
        groupKey: `sla-warning:${text(p, "windowId") ?? bindingId ?? item.subjectId ?? ""}`,
      };
    }

    case "provider.stake_headroom_low": {
      const staked = amount(p, "staked");
      const required = amount(p, "required");
      if (!staked || !required) return stored;
      const margin =
        amount(p, "margin") ??
        ({ ...required, amount: ((BigInt(required.amount) * HEADROOM_PERCENT) / 100n).toString() } as Money);
      return {
        title: `${tool ? `${tool}: your` : "Your"} stake (${formatMoney(staked)}) is within ${formatMoney(margin)} of the ${formatMoney(required)} minimum`,
        body:
          `Below the minimum, paid calls continue for ${grace}, then stop until you add stake. ` +
          "A penalty can take you below it. Add stake to keep a margin.",
        target: addStake,
        groupKey: `stake-headroom:${bindingId ?? ""}`,
      };
    }

    case "provider.stake_grace_opened": {
      const staked = amount(p, "staked");
      const required = amount(p, "required");
      if (!staked || !required) return stored;
      const until = when(text(p, "expiresAt"), ctx);
      return {
        title: `${tool ?? "One paid tool"}: your stake is below the ${formatMoney(required)} minimum`,
        body:
          `Your stake (${formatMoney(staked)}) is below the ${formatMoney(required)} minimum. ` +
          `Paid calls continue${until ? ` until ${until}` : ` for ${grace}`}; unpaid earnings go to your stake meanwhile. ` +
          `If it is still below then, ${tool ?? "the tool"} stops taking paid calls. Add stake.`,
        target: addStake,
        groupKey: null,
      };
    }

    case "provider.stake_grace_expired": {
      const required = amount(p, "required");
      return {
        title: `${tool ?? "One paid tool"} stopped taking paid calls: stake below the minimum`,
        body: `Your stake stayed below the ${required ? `${formatMoney(required)} ` : ""}minimum for ${grace}, so paid calls stopped. Add stake to start them again.`,
        target: addStake,
        groupKey: null,
      };
    }

    case "provider.stake_grace_cured": {
      const required = amount(p, "required");
      return {
        title: `${tool ?? "One paid tool"}: your stake is back above the minimum`,
        body: `Your stake covers the ${required ? `${formatMoney(required)} ` : ""}minimum again. Paid calls continue without interruption.`,
        target: null,
        groupKey: null,
      };
    }

    case "call_dispute.opened": {
      if (p.role !== "provider") return stored;
      const reason = text(p, "reasonLabel");
      const dueAt =
        text(p, "replyDueAt") ??
        (Number.isNaN(Date.parse(item.createdAt)) ? null : new Date(Date.parse(item.createdAt) + REPLY_WINDOW_MS).toISOString());
      const due = when(dueAt, ctx);
      const passed = dueAt !== null && Date.parse(dueAt) <= (ctx.now ?? Date.now());
      const autoUphold = p.autoUpholdAt === undefined ? undefined : when(text(p, "autoUpholdAt"), ctx);
      const consequence =
        autoUphold === undefined
          ? "If you stay silent, it is decided without your side."
          : autoUphold
            ? `If you stay silent, it can be upheld automatically from ${autoUphold}.`
            : "If you stay silent, an operator decides it without your side.";
      return {
        title: "A buyer reported a bad result on a call you served",
        body:
          (reason ? `The buyer says: "${reason}". ` : "") +
          (due ? (passed ? `The reply window closed ${due}.` : `Reply by ${due}. ${consequence}`) : "Reply on the report's page."),
        target: null,
        groupKey: null,
      };
    }

    default:
      return stored;
  }
}
