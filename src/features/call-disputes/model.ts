import type { StatusTimelineStep } from "@/components/patterns/status-timeline";
import type { Money } from "@/interfaces/api";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import type { CallDispute, CallDisputeReason } from "@/services/call-disputes.service";
import { formatMoney } from "@/utils/money";
import { DECISION_HOURS, HELD_TIMEOUT_DAYS, PROVIDER_REPLY_HOURS, REPORTS_PER_DAY } from "@/libs/dispute-deadlines";

/**
 * "Report a bad result" (backlog G3.B1, analysis of the dispute hold), the
 * words and the timeline every screen shows. Pure.
 *
 * The clock, from the filing:
 *   - the payment is held for 1 hour after the call settles; a report filed
 *     inside that window is refunded in full if it is upheld;
 *   - the provider may reply once, within 24 hours;
 *   - an operator decides within 72 hours. A provider that stayed silent for
 *     24 hours is upheld automatically at 72 hours; a provider that replied
 *     keeps the payment held while an operator is paged.
 * The platform never pays a refund out of its own money: it comes from the
 * held payment, or from a debt that is voided.
 */

export const HOUR_MS = 3_600_000;
export { DECISION_HOURS, HELD_TIMEOUT_DAYS, PROVIDER_REPLY_HOURS } from "@/libs/dispute-deadlines";
export const NOTE_MAX = 1000;
export const REPLY_MAX = 1000;
/** The operator's note, shown to both sides verbatim. */
export const DECISION_NOTE_MIN = 10;
export const DECISION_NOTE_MAX = 2048;

export const REASON_OPTIONS: readonly { value: CallDisputeReason; label: string; hint: string }[] = [
  { value: "WRONG_DATA", label: "Wrong data", hint: "The answer looks right but the facts in it are wrong." },
  { value: "EMPTY_OR_GARBAGE", label: "Empty or garbage result", hint: "Nothing useful came back, or it was unreadable." },
  { value: "WRONG_FORMAT", label: "Wrong format", hint: "The fields or types are not what the tool promises." },
  { value: "TOO_SLOW", label: "Too slow", hint: "It answered, but too late to be of use." },
  { value: "OTHER", label: "Something else", hint: "Say what was wrong in the note." },
];

export function reasonLabel(reason: string, fallback?: string): string {
  return REASON_OPTIONS.find((r) => r.value === reason)?.label ?? fallback ?? reason;
}

/** The provider's reply is accepted until then: the API states it. */
export function replyDueAt(dispute: Pick<CallDispute, "replyDueAt">): string {
  return dispute.replyDueAt;
}

/** The decision SLA: the API states it. */
export function decisionDueAt(dispute: Pick<CallDispute, "decisionDueAt">): string {
  return dispute.decisionDueAt;
}

/** The provider's payment was refunded to the buyer because the provider was blocked, before any decision. */
export function refundedBeforeDecision(dispute: Pick<CallDispute, "state" | "refundState">): boolean {
  return dispute.state === "OPEN" && dispute.refundState === "REFUNDED";
}

/**
 * The dispute copy every screen uses, one clock per sentence (decided
 * rules): the provider's reply window, the automatic uphold of a silent
 * provider, the operator's decision, and what a report after the hold means.
 * The 7-day chain timeout is a safety net for a platform that never acts,
 * never the normal outcome: it appears only as secondary text.
 */
export const DISPUTE_COPY = {
  reply: `The provider has ${PROVIDER_REPLY_HOURS} hours to reply.`,
  silent: `If the provider stays silent, the report is upheld automatically at ${DECISION_HOURS} hours.`,
  silentRefund: `If the provider stays silent, the report is upheld automatically at ${DECISION_HOURS} hours and you are refunded.`,
  decides: `An operator decides within ${DECISION_HOURS} hours.`,
  held: "The payment stays held until the report is decided.",
  afterHold: "The payment has already been collected. If the report is upheld, it counts against the provider's quality, but a refund is not guaranteed.",
  safetyNet: `Safety net: if the platform itself never acts, the chain releases a held payment to the provider after ${HELD_TIMEOUT_DAYS} days.`,
  limit: `You can report up to ${REPORTS_PER_DAY} calls in 24 hours.`,
} as const;

function money(value: Money | null | undefined): string | null {
  return value ? formatMoney(value, { decimals: 4 }) : null;
}

export type DisputeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "teal";

export interface DisputeStatusView {
  label: string;
  tone: DisputeTone;
  /** One sentence for the buyer. */
  detail: string;
}

/** The buyer's one-line status. */
export function buyerStatus(dispute: CallDispute, now: number): DisputeStatusView {
  const refunded = money(dispute.restoredAmount ?? dispute.refundAmount ?? dispute.amount);
  if (dispute.state === "WITHDRAWN") return { label: "Withdrawn", tone: "neutral", detail: "You withdrew this report." };
  if (refundedBeforeDecision(dispute)) {
    return {
      label: "Refunded · decision pending",
      tone: "teal",
      detail: `The provider was blocked, so the payment${refunded ? ` of ${refunded}` : ""} went back to your balance. ${DISPUTE_COPY.decides}`,
    };
  }
  if (dispute.state === "OPEN") {
    const silent = !dispute.providerRespondedAt;
    const replyOpen = silent && now < Date.parse(replyDueAt(dispute));
    return {
      label: replyOpen ? "Waiting for the provider" : "Waiting for a decision",
      tone: "primary",
      detail: dispute.refundGuaranteed ? `${DISPUTE_COPY.held} If it is upheld, you are refunded in full.` : DISPUTE_COPY.afterHold,
    };
  }
  if (dispute.state === "UPHELD") {
    switch (dispute.refundState) {
      case "REFUNDED":
        return { label: "Upheld · refunded", tone: "success", detail: `You were refunded${refunded ? ` ${refunded}` : ""}.` };
      case "PENDING":
        return { label: "Upheld · refund on its way", tone: "success", detail: "The refund is being booked. It lands in your balance within minutes." };
      case "NOT_CHARGED":
        return { label: "Upheld", tone: "success", detail: "You were never charged for this call." };
      case "NOT_REFUNDABLE":
        return { label: "Upheld · no refund", tone: "warning", detail: "It counts against the provider, but the payment had already been collected, so nothing could be refunded." };
      default:
        return { label: "Upheld", tone: "success", detail: "It counts against the provider's quality." };
    }
  }
  if (dispute.state === "REJECTED") {
    return dispute.refundState === "REFUNDED"
      ? { label: "Rejected · refunded anyway", tone: "teal", detail: "The report was rejected, but the call was refunded because its provider was blocked." }
      : { label: "Rejected", tone: "neutral", detail: "The call stays charged. The reviewer's reason is below." };
  }
  return { label: dispute.state, tone: "neutral", detail: "" };
}

/** The provider's one-line status: never names the buyer. */
export function providerStatus(dispute: CallDispute, now: number): DisputeStatusView {
  if (dispute.state === "WITHDRAWN") return { label: "Withdrawn", tone: "neutral", detail: "The buyer withdrew the report." };
  if (dispute.state === "OPEN") {
    if (dispute.canRespond) {
      return { label: "Reply needed", tone: "warning", detail: `Reply once, within ${PROVIDER_REPLY_HOURS} hours of the report. If you stay silent, it is upheld automatically at ${DECISION_HOURS} hours.` };
    }
    if (!dispute.providerRespondedAt && now >= Date.parse(replyDueAt(dispute))) {
      return { label: "Reply window closed", tone: "danger", detail: `You did not reply within ${PROVIDER_REPLY_HOURS} hours. The report is upheld automatically at ${DECISION_HOURS} hours unless an operator decides first.` };
    }
    return { label: "Waiting for a decision", tone: "primary", detail: `You replied. ${DISPUTE_COPY.decides}` };
  }
  if (dispute.state === "UPHELD") return { label: "Upheld", tone: "danger", detail: "It counts against this listing's quality." };
  if (dispute.state === "REJECTED") return { label: "Rejected", tone: "success", detail: "The payment is yours." };
  return { label: dispute.state, tone: "neutral", detail: "" };
}

/**
 * The timeline: reported (and held), the provider's reply, a refund before
 * the decision (a blocked provider), the decision, and the refund.
 */
export function disputeTimeline(dispute: CallDispute, now: number, side: "buyer" | "provider" = "buyer"): StatusTimelineStep[] {
  const steps: StatusTimelineStep[] = [];
  const decided = dispute.state === "UPHELD" || dispute.state === "REJECTED";
  const withdrawn = dispute.state === "WITHDRAWN";
  const replyDue = replyDueAt(dispute);
  const replyClosed = now >= Date.parse(replyDue);
  const amount = money(dispute.amount);

  steps.push({
    id: "reported",
    label: side === "buyer" ? "Reported" : "Buyer reported it",
    state: "done",
    date: dispute.createdAt,
    description: dispute.refundGuaranteed
      ? `Inside the 1-hour hold: the payment${amount ? ` of ${amount}` : ""} is held, not paid out.`
      : "After the 1-hour hold: the payment had already been collected.",
  });

  const blocked = dispute.refundState === "REFUNDED" && !decided && !withdrawn;
  if (dispute.providerRespondedAt) {
    const reply = dispute.providerResponse ?? "";
    steps.push({ id: "reply", label: "Provider replied", state: "done", date: dispute.providerRespondedAt, description: reply ? `“${reply.length > 140 ? `${reply.slice(0, 139)}…` : reply}”` : undefined });
  } else if (blocked) {
    steps.push({ id: "reply", label: "No reply needed: provider blocked", state: "skipped" });
  } else if (withdrawn || decided || replyClosed) {
    steps.push({
      id: "reply",
      label: "No reply from the provider",
      state: "skipped",
      date: replyDue,
      dateLabel: "Window closed",
      description: withdrawn ? undefined : `The ${PROVIDER_REPLY_HOURS}-hour reply window closed.`,
    });
  } else {
    steps.push({
      id: "reply",
      label: side === "provider" ? "Your reply is due" : "Provider may reply",
      state: "current",
      date: replyDue,
      dateLabel: "Due",
      countdown: true,
      urgent: side === "provider",
      description: DISPUTE_COPY.reply,
    });
  }

  if (blocked) {
    steps.push({
      id: "refunded-early",
      label: "Refunded",
      state: "done",
      date: dispute.updatedAt,
      description: "The provider was blocked, so the held payment went back to the buyer. The decision still follows.",
    });
  }

  if (withdrawn) {
    steps.push({ id: "decision", label: "Withdrawn", state: "skipped", date: dispute.updatedAt });
    return steps;
  }

  if (decided) {
    steps.push({
      id: "decision",
      label: dispute.state === "UPHELD" ? "Upheld" : "Rejected",
      state: "done",
      date: dispute.resolvedAt ?? dispute.updatedAt,
    });
  } else {
    const silent = !dispute.providerRespondedAt;
    steps.push({
      id: "decision",
      label: "Decision",
      state: dispute.providerRespondedAt || replyClosed ? "current" : "upcoming",
      date: decisionDueAt(dispute),
      dateLabel: "Decided by",
      description: silent && dispute.autoUpholdAt ? (side === "buyer" ? DISPUTE_COPY.silentRefund : DISPUTE_COPY.silent) : DISPUTE_COPY.decides,
    });
  }

  const refund = refundStep(dispute, decided);
  if (refund) steps.push(refund);
  return steps;
}

function refundStep(dispute: CallDispute, decided: boolean): StatusTimelineStep | null {
  const refunded = money(dispute.restoredAmount ?? dispute.refundAmount ?? dispute.amount);
  if (!decided) {
    if (dispute.refundState === "REFUNDED") return null;
    return {
      id: "refund",
      label: "Refund",
      state: "upcoming",
      description: dispute.refundGuaranteed ? "In full, if upheld." : "Not guaranteed: the payment was already collected.",
    };
  }
  if (dispute.state === "REJECTED") {
    return dispute.refundState === "REFUNDED"
      ? { id: "refund", label: "Refunded anyway", state: "done", description: "The provider was blocked." }
      : { id: "refund", label: "No refund", state: "skipped" };
  }
  switch (dispute.refundState) {
    case "REFUNDED":
      return { id: "refund", label: refunded ? `Refunded ${refunded}` : "Refunded", state: "done", date: dispute.resolvedAt ?? dispute.updatedAt };
    case "PENDING":
      return { id: "refund", label: "Refund on its way", state: "current", description: "Booking now; usually within minutes." };
    case "NOT_CHARGED":
      return { id: "refund", label: "Not charged", state: "done", description: "The call was never charged." };
    case "NOT_REFUNDABLE":
      return { id: "refund", label: "Not refundable", state: "failed", description: "The payment had already been collected." };
    default:
      return null;
  }
}

/* -------------------------------------------------------------- receipts */

export interface ReportWindowView {
  /** A report is still accepted. */
  open: boolean;
  /** A report now is refunded in full if upheld. */
  guaranteed: boolean;
  /** When the full-refund window ends, if it has not. */
  holdEndsAt: string | null;
  text: string;
}

/** What a report filed now would mean, from the receipt's hold fields. */
export function reportWindow(
  receipt: { status: string; disputeWindowEndsAt?: string | null; disputeFilingClosesAt?: string | null; chargedPrice: Money },
  now: number,
): ReportWindowView {
  const closes = receipt.disputeFilingClosesAt ?? null;
  const open = closes !== null && now < Date.parse(closes);
  const holdEnds = receipt.disputeWindowEndsAt ?? null;
  const guaranteed = open && holdEnds !== null && now < Date.parse(holdEnds);
  if (!open) {
    return {
      open: false,
      guaranteed: false,
      holdEndsAt: null,
      text: closes !== null ? "The time to report this call has passed." : "Only a finished, charged call can be reported.",
    };
  }
  return guaranteed
    ? { open, guaranteed, holdEndsAt: holdEnds, text: "The payment is still held. Report it now and, if upheld, you are refunded in full." }
    : { open, guaranteed, holdEndsAt: null, text: `The 1-hour hold has ended. ${DISPUTE_COPY.afterHold}` };
}

/* ---------------------------------------------------------- operator SLA */

export interface SlaMark {
  label: string;
  tone: "neutral" | "warning" | "danger";
  /** The next deadline on this dispute. */
  dueAt: string | null;
}

/**
 * The marks on an open dispute in the operator's queue: reply window, the
 * 48-hour page, and the 72-hour auto-uphold (provider silent) or overdue
 * (provider replied: held, paged).
 */
export function slaMarks(dispute: Pick<CallDispute, "state" | "providerRespondedAt" | "replyDueAt" | "pageAt" | "decisionDueAt" | "autoUpholdAt">, now: number): SlaMark[] {
  if (dispute.state !== "OPEN") return [];
  const silent = !dispute.providerRespondedAt;
  const auto = dispute.autoUpholdAt !== null;
  const marks: SlaMark[] = [];
  if (silent && now < Date.parse(dispute.replyDueAt)) marks.push({ label: "Provider may reply", tone: "neutral", dueAt: dispute.replyDueAt });
  if (silent && now >= Date.parse(dispute.replyDueAt)) marks.push({ label: "Provider silent", tone: "warning", dueAt: null });
  if (now >= Date.parse(dispute.decisionDueAt)) {
    marks.push(auto ? { label: "Auto-uphold due", tone: "danger", dueAt: dispute.decisionDueAt } : { label: "Overdue: decide now", tone: "danger", dueAt: dispute.decisionDueAt });
  } else if (now >= Date.parse(dispute.pageAt)) {
    marks.push({ label: auto ? "Paged · auto-uphold at 72 h" : "Paged · decide by 72 h", tone: "danger", dueAt: dispute.decisionDueAt });
  } else {
    marks.push({ label: auto ? "Auto-uphold at 72 h" : "Decide by 72 h", tone: "neutral", dueAt: dispute.decisionDueAt });
  }
  return marks;
}

/**
 * The operator queue's query: open disputes oldest first from the server
 * (the default is newest first, which would push the most urgent ones past
 * the first page), every dispute newest first.
 */
/** The operator queue's page size. */
export const QUEUE_PAGE = 20;

export function disputeQueueQuery(show: "open" | "all", flaggedOnly: boolean, cursor?: string) {
  return show === "open"
    ? { state: ["OPEN"] as const, order: "ASC" as const, flaggedOnly, cursor, limit: QUEUE_PAGE }
    : { order: "DESC" as const, flaggedOnly, cursor, limit: QUEUE_PAGE };
}

/** Oldest first: the queue's order is the SLA's. */
export function bySlaUrgency<T extends Pick<CallDispute, "createdAt">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** What an upheld decision would do now, from `intent.refundPlan`. */
export const REFUND_PLAN_TEXT: Readonly<Record<string, string>> = {
  RELEASE_HELD: "Upholding returns the held payment to the buyer's escrow. Nobody is credited.",
  VOID_DEBT: "Upholding voids the buyer's unpaid debt for this call.",
  NOT_CHARGED: "The buyer was not charged; upholding only counts against the provider.",
  COLLECTION_IN_PROGRESS: "The payment is moving right now. Wait a minute before deciding.",
  COLLECTED: "The payment was already collected; upholding counts against quality, but a refund is not guaranteed.",
  ALREADY_REFUNDED: "The refund has already landed (a decision being retried); deciding again moves no money.",
};

/* ----------------------------------------------------------------- errors */

export function disputeErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : "That did not work. Try again.";
  switch (error.code) {
    case "DISPUTE_CALL_NOT_DISPUTABLE":
      return "This call can't be reported: only a finished, paid call can.";
    case "DISPUTE_FILING_WINDOW_CLOSED":
      return "The time to report this call has passed.";
    case "DISPUTE_ALREADY_OPEN":
      return "You already reported this call. Its status is below.";
    case "DISPUTE_RATE_LIMITED":
      return `${DISPUTE_COPY.limit} That limit is reached; try again later.`;
    case "DISPUTE_ALREADY_RESPONDED":
      return "A reply was already sent, or the report was decided.";
    case "DISPUTE_NOT_DECIDABLE":
      return "This report was already decided or withdrawn.";
    case "DISPUTE_COLLECTION_IN_PROGRESS":
      return "The payment is moving right now. Try again in a minute.";
    case "DISPUTE_NOT_WITHDRAWABLE":
      return "This report can no longer be withdrawn.";
    case "DISPUTE_NOT_FOUND":
      return "This report could not be found.";
    default:
      return plainError(error.code);
  }
}
