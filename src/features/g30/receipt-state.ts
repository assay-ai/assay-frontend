import type { StageCheck, StageCheckStatus } from "@/components/ui/stage-list";
import { formatDateTime } from "@/libs/utc-time";
import { formatMoney, toDecimal } from "@/utils/money";
import { presentVerdict } from "@/utils/verdict";
import { refundPromiseLive } from "./refund-promise";

import type { Receipt, ReceiptStage, WireStageName, WireStageStatus } from "./wire";

/**
 * Everything the receipt screens (the charged receipt / the not-charged receipt) need to turn one wire receipt
 * into words. Every sentence below is verbatim from the receipt designs and
 * `LmsKR`, or comes from `presentVerdict()`; nothing here is paraphrased.
 */

/* ------------------------------------------------------------ the four stages */

/**
 * The design's "Stage List" names the four pipeline stages. The wire names
 * them by their internal enum, so this is the only place the two vocabularies
 * meet.
 */
const STAGE_NAME: Record<WireStageName, string> = {
  SCHEMA: "Response shape",
  DETERMINISTIC_RULES: "Result quality rules",
  CROSS_CHECK: "Independent cross-check",
  SEMANTIC: "Relevance check",
};

/** The glossary entry that explains each stage, for a `Term` around its name. */
export const STAGE_TERM: Partial<Record<WireStageName, "cross-check" | "relevance-check" | "response-shape" | "quality-rules">> = {
  SCHEMA: "response-shape",
  DETERMINISTIC_RULES: "quality-rules",
  CROSS_CHECK: "cross-check",
  SEMANTIC: "relevance-check",
};

/**
 * Eight wire statuses collapse onto the five the design draws.
 *
 * The load-bearing half of this map is the default: ANY status that is not
 * literally PASSED, FAILED, SKIPPED or NOT_APPLICABLE becomes "not reached".
 * NOT_APPLICABLE is its own word ("does not apply"): the tool declares no such
 * check, so nothing was cut short. A stage that did
 * not run must never render as a tick — the API says so itself ("`passed` is
 * the only status that may ever be rendered as a tick"), and on this product a
 * false tick is a claim that money was checked when it was not.
 */
const STAGE_STATUS: Record<WireStageStatus, StageCheckStatus> = {
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "not-sampled",
  NOT_REACHED: "not-reached",
  NOT_APPLICABLE: "not-applicable",
  NOT_IMPLEMENTED: "not-reached",
  MISAPPLIED: "not-reached",
  UNAVAILABLE: "not-reached",
};

export function stageStatus(stage: ReceiptStage): StageCheckStatus {
  const mapped = STAGE_STATUS[stage.status] ?? "not-reached";
  // Belt and braces: the wire's own `passed` flag overrides an optimistic
  // status if they ever disagree. Only a true `passed` may show a tick.
  if (mapped === "passed" && stage.passed === false) return "not-reached";
  return mapped;
}

/** The design's own note for each stage, used where the wire has none. */
const STAGE_FALLBACK_NOTE: Partial<Record<WireStageName, string>> = {
  SCHEMA: "runs on every call",
  DETERMINISTIC_RULES: "runs on every call",
};

/** The API's own note on a stage that did not run — true, but it said nothing about THIS call. */
const GENERIC_NOT_REACHED = "checks stop at the first failure";

/** A stage on a call that has no check result at all (not charged for another reason, or served unchecked). */
const NO_CHECK_RESULT_NOTE = "no check result was recorded";

/** The same sentence, ignoring case and a final full stop: the API sends it as note AND detail. */
function sameSentence(a: string | undefined | null, b: string | undefined | null): boolean {
  const norm = (text: string) => text.trim().replace(/\.$/, "").toLowerCase();
  return Boolean(a && b && norm(a) === norm(b));
}

/**
 * The receipt's stage rows, told as one story with the rest of the receipt.
 *
 * Two corrections over the wire rows:
 *  - a call refunded for a result in the wrong format (`REFUNDED`, no verdict
 *    record) was rejected by the response-shape check before the pipeline
 *    started, so that stage is shown as the one that failed;
 *  - a stage that did not run says WHY for this call ("an earlier check
 *    failed", or "there was no result to check") once, instead of the API's
 *    generic note printed twice per row.
 */
export function toStageChecks(receipt: Receipt): StageCheck[] {
  const story = isFinalNotChargedReceipt(receipt) ? notChargedStory(receipt) : null;
  const rows = receipt.stages.map((stage) => {
    let status = stageStatus(stage);
    let detail = stage.detail ?? undefined;
    if (story?.reason === "WRONG_FORMAT" && stage.stage === "SCHEMA" && status === "not-reached") {
      status = "failed";
      detail = "The result did not match the format this tool promises.";
    }
    return { stage, status, detail };
  });
  const anyFailed = rows.some((row) => row.status === "failed");
  // Nothing ran, nothing failed, and no not-charged story explains it: the
  // call has no check result. The API's "checks stop at the first failure"
  // read there as if a check had failed (V1-8).
  const noneRan = !rows.some((row) => row.status === "passed" || row.status === "failed");

  return rows.map(({ stage, status, detail }) => {
    const sampledNote =
      stage.stage === "SEMANTIC" && status === "not-sampled"
        ? receipt.sampling.display ?? undefined
        : undefined;
    let note = sampledNote ?? stage.note ?? STAGE_FALLBACK_NOTE[stage.stage];
    if (status === "not-reached") {
      note = anyFailed
        ? "not run: an earlier check failed"
        : story
          ? story.notRunNote
          : noneRan
            ? NO_CHECK_RESULT_NOTE
            : note;
      if (detail === GENERIC_NOT_REACHED) detail = undefined;
    }
    // "does not apply" says it all: the API's "this check does not apply to
    // this tool", sent as both note and detail, would repeat it twice more.
    if (status === "not-applicable") {
      if (note && /does not apply/i.test(note)) note = undefined;
      if (detail && /does not apply/i.test(detail)) detail = undefined;
    }
    if (sameSentence(detail, note)) detail = undefined;

    return {
      id: stage.stage,
      name: STAGE_NAME[stage.stage] ?? stage.stage,
      term: STAGE_TERM[stage.stage],
      status,
      note,
      detail,
      detailVariant: status === "failed" ? ("error" as const) : ("info" as const),
    };
  });
}

/**
 * Whether the "This result was actually fine" block may be shown.
 *
 * It tells us a check was wrong, so it needs a check that ran and rejected the
 * result. A voided, expired or errored call is also "not charged", but every
 * stage on it is "not reached" and there is nothing to contest (BUG-R2-B1-02).
 */
export function canContestRejection(receipt: Receipt): boolean {
  return receipt.stages.some((stage) => stageStatus(stage) === "failed");
}

/* ------------------------------------------------------------- screen states */

/**
 * The states this screen has to render. `CHARGED` is the design;
 * `NOT_CHARGED` is the design's headline; the other five are the five cards
 * drawn in `LmsKR` > "The other states this screen has to render", each of
 * which owns its own sentence because — the design's words — "collapsing them
 * into one 'error' is a three-year support tax".
 */
export type ReceiptState =
  | "CHECKING"
  | "CHARGED"
  | "NOT_CHARGED"
  | "EMPTY_CONFIRMED"
  | "MISAPPLIED"
  | "SYSTEM_ERROR"
  | "REQUEST_ERROR"
  | "EXPIRED"
  | "DEBT_OUTSTANDING"
  | "DEBT_WRITTEN_OFF"
  | "DEBT_VOIDED"
  | "FORFEITED";

/** PaymentIntentStatus values that mean the call has not finished. */
const IN_FLIGHT = new Set(["CREATED", "FUNDS_SECURED", "PROVIDER_EXECUTING", "VERIFYING"]);

export function deriveReceiptState(receipt: Receipt): ReceiptState {
  if (IN_FLIGHT.has(receipt.status)) return "CHECKING";
  // Served and passed, but the payment is not the usual one: say so before
  // the charged / not-charged headlines, which would each be half true.
  if (receipt.status === "SETTLED") {
    if (receipt.debt === "OUTSTANDING") return "DEBT_OUTSTANDING";
    if (receipt.debt === "WRITTEN_OFF") return "DEBT_WRITTEN_OFF";
    if (receipt.debt === "VOIDED") return "DEBT_VOIDED";
    if (receipt.forfeited) return "FORFEITED";
  }
  // An expired intent never completed, whatever classification a row carries.
  if (receipt.status === "EXPIRED") return "EXPIRED";
  if (receipt.classification === "SYSTEM_ERROR") return "SYSTEM_ERROR";
  if (receipt.classification === "REQUEST_ERROR") return "REQUEST_ERROR";

  const verdict = receipt.verdict?.status;
  if (verdict === "MISAPPLIED") return "MISAPPLIED";
  if (verdict === "EMPTY_CONFIRMED") return "EMPTY_CONFIRMED";

  // A settled call is charged, even at $0 (a free-tier call): "not charged"
  // is reserved for calls that ended without a charge.
  return receipt.status === "SETTLED" || receipt.chargedPrice.amount !== "0" ? "CHARGED" : "NOT_CHARGED";
}

export type StateTone = "primary" | "neutral" | "warning" | "danger";

export interface StateCard {
  /** The wire token, shown as the card's own eyebrow — as the design draws it. */
  code: string;
  /** Lucide icon name, from the design. */
  icon: "loader" | "circle-dot" | "circle-alert" | "server-crash" | "file-x";
  tone: StateTone;
  /** The sentence. Verbatim from `LmsKR`. */
  sentence: string;
  /** The money line, e.g. "$0.0100 held" or "charged $0.0100". */
  money: (receipt: Receipt) => string;
  /** True when the money line is the teal counterfactual figure. */
  moneyTeal: boolean;
}

const price = (receipt: Receipt) => formatMoney(receipt.listedPrice, { decimals: 4 });
const charged = (receipt: Receipt) => formatMoney(receipt.chargedPrice, { decimals: 4 });

/** The five cards from `LmsKR`, in the order the design lays them out. */
export const STATE_CARDS: Record<Exclude<ReceiptState, "CHARGED" | "NOT_CHARGED">, StateCard> = {
  CHECKING: {
    code: "CHECKING",
    icon: "loader",
    tone: "primary",
    sentence: "Checking — you have not been charged yet",
    money: (r) => `${price(r)} held`,
    moneyTeal: false,
  },
  EMPTY_CONFIRMED: {
    code: "EMPTY_CONFIRMED",
    icon: "circle-dot",
    tone: "neutral",
    sentence: "No results, and no results was the right answer",
    money: (r) => `charged ${charged(r)}`,
    moneyTeal: false,
  },
  MISAPPLIED: {
    code: "MISAPPLIED",
    icon: "circle-alert",
    tone: "warning",
    sentence: "This request was outside what the tool covers. You were not charged.",
    money: (r) => charged(r),
    moneyTeal: true,
  },
  SYSTEM_ERROR: {
    code: "SYSTEM_ERROR",
    icon: "server-crash",
    tone: "danger",
    sentence: "The tool did not respond. You were not charged.",
    money: (r) => charged(r),
    moneyTeal: true,
  },
  REQUEST_ERROR: {
    code: "REQUEST_ERROR",
    icon: "file-x",
    tone: "danger",
    sentence: "The request was rejected as malformed. You were not charged.",
    money: (r) => charged(r),
    moneyTeal: true,
  },
  EXPIRED: {
    code: "EXPIRED",
    icon: "circle-alert",
    tone: "warning",
    sentence:
      "The call did not complete in time. You were not charged, and the funds held for it were released.",
    money: (r) => charged(r),
    moneyTeal: true,
  },
  DEBT_OUTSTANDING: {
    code: "DEBT_OUTSTANDING",
    icon: "circle-alert",
    tone: "warning",
    sentence:
      "This call was served and passed, but its payment could not be collected from your escrow. The price is still held there. Settle it with the Settle button in the banner above (if you signed already, it is being collected): paid calls are paused until it is collected, and free calls still work.",
    money: (r) => `${price(r)} owed`,
    moneyTeal: false,
  },
  DEBT_WRITTEN_OFF: {
    code: "DEBT_WRITTEN_OFF",
    icon: "circle-alert",
    tone: "warning",
    sentence:
      "This call was served, but its payment was never settled, so it was written off for the provider: the funds held for it were released and the provider was not paid. You still owe it to resume paid calls. Paid calls stay paused until you settle it from the banner above, and settling it pays the provider.",
    money: (r) => `${price(r)} owed`,
    moneyTeal: false,
  },
  DEBT_VOIDED: {
    code: "DEBT_VOIDED",
    icon: "circle-alert",
    tone: "neutral",
    sentence:
      "This call's payment had lapsed, and its check then finished without a pass, so the debt was voided. You were not charged, the funds held for it were released, and the provider was not paid.",
    money: (r) => charged(r),
    moneyTeal: true,
  },
  FORFEITED: {
    code: "FORFEITED",
    icon: "circle-alert",
    tone: "neutral",
    sentence:
      "Not charged: the provider forfeited this payment. The call passed, but the provider's account could not be paid (its stake was below the minimum, or it was blocked).",
    money: (r) => charged(r),
    moneyTeal: true,
  },
};

/** The receipt states whose payment is not the usual charge or refund. */
export const COLLECTION_STATES: ReadonlySet<ReceiptState> = new Set([
  "DEBT_OUTSTANDING",
  "DEBT_WRITTEN_OFF",
  "DEBT_VOIDED",
  "FORFEITED",
]);

export const STATE_CARD_ORDER = [
  "CHECKING",
  "EMPTY_CONFIRMED",
  "MISAPPLIED",
  "SYSTEM_ERROR",
  "REQUEST_ERROR",
] as const;

/* ------------------------------------------------------------- the headlines */

/**
 * The charged receipt headline: "Charged $0.0010. Passed every check we run on this call."
 *
 * The second sentence is never written here — it comes from `presentVerdict()`,
 * which is the only thing allowed to turn a verdict into words (a design-system
 * rule). Three of its wordings are marked `provisional`; this screen is one
 * of the two places they surface, and the caller is expected to say so.
 */
export function chargedHeadline(receipt: Receipt): string {
  const amount = formatMoney(receipt.chargedPrice, { decimals: 4 });
  // No check result: say so, never "No result recorded" (which reads as "no data came back").
  if (chargedCheck(receipt) === "UNCHECKED") return `Charged ${amount}. ${UNCHECKED_SENTENCE}`;
  const shown = presentVerdict(receipt.verdict?.status ?? null).shownAs;
  const sentence = shown.endsWith(".") ? shown : `${shown}.`;
  return `Charged ${amount}. ${sentence}`;
}

/**
 * The charged receipt sub-line, shown only when it is true: the design's example has the
 * relevance judgement as the one stage that did not run, and shows this to say
 * that "sampled" is not "skipped". Rendering it on a receipt where two stages
 * did not run would be a false statement, so it is conditional.
 */
export function samplingSubline(receipt: Receipt): string | null {
  const semantic = receipt.stages.find((s) => s.stage === "SEMANTIC");
  if (!semantic || stageStatus(semantic) !== "not-sampled") return null;
  const others = receipt.stages.filter((s) => s.stage !== "SEMANTIC");
  if (!others.every((s) => stageStatus(s) === "passed")) return null;
  return "One check (relevance) runs on a sample of calls; this call was not in the sample.";
}

/**
 * The sampling explainer's copy for one receipt.
 *
 * The design's paragraph ("judging every one would cost more than the call
 * itself. Instead we sample…") is only true for a call that IS sampled. The
 * backend derives `rate = min(1, budget / judgementCost)` and a rate of 1 means
 * the call was judged every time — printing the sampling paragraph beside
 * "every call" contradicted itself. Such a call gets a sentence saying so, and
 * no tail (the tail is the guaranteed-tier rule the sentence already covers).
 */
export function samplingExplainerCopy(
  receipt: Receipt,
  listed: string,
): { body?: string; tail?: string; rate?: string } {
  // The tool declares no relevance judgement at all: the stage reads "does not
  // apply", and a sampling rate beside it (the backend still derives one from
  // the price) would describe a check that never runs (BUG-R16-B1-02).
  const semantic = receipt.stages?.find((s) => s.stage === "SEMANTIC");
  if (semantic?.status === "NOT_APPLICABLE") {
    return {
      body: "This tool does not declare a relevance judgement, so no call to it is judged for relevance and nothing on this receipt is sampled. The other checks above are what decided this call.",
      tail: "",
      rate: "",
    };
  }
  const rate = receipt.sampling.rate;
  if (typeof rate === "number" && rate >= 1) {
    return {
      body: `The relevance check runs on every call at ${listed}, so nothing on this receipt is sampled.`,
      tail: "",
    };
  }
  // The default tail says tools at $0.05 and above are judged on every call.
  // This call is at least that price and WAS sampled, so the tail would
  // contradict the paragraph above it (BUG-R2-B1-02).
  const tail = toDecimal(receipt.listedPrice).gte("0.05") ? { tail: "" } : {};
  return {
    ...tail,
    body: `The relevance check is the only sampled check. At ${listed} a call, judging every one would cost more than the call itself. Instead we sample, and the provider’s stake covers the rest: if their measured quality falls below what they published, they pay a penalty from it and you are compensated for what you spent in that window.`,
  };
}

/* ------------------------------------------------ what was checked */

/**
 * What the checks said about a charged call, the one fact the headline, the
 * money strip and the timeline all hang on:
 *  - `PASSED`: a check ran and passed, or the verdict is a pass with stages
 *    that ran (or none sent);
 *  - `UNCHECKED`: no check passed, and no verdict was recorded or no check
 *    ran at all (every stage not reached, not sampled or not applicable). The
 *    call was served and charged, but nothing may say "Check passed";
 *  - `CHECKED`: a verdict other than a pass, with no stage that passed.
 *
 * The stages decide first: a passed stage is drawn as a tick in the checks
 * panel, so the headline must not say "no check result" beside it.
 */
export type ChargedCheck = "PASSED" | "UNCHECKED" | "CHECKED";

export function chargedCheck(receipt: Pick<Receipt, "verdict" | "stages">): ChargedCheck {
  const verdict = receipt.verdict?.status ?? null;
  const statuses = (receipt.stages ?? []).map(stageStatus);
  const ran = statuses.some((status) => status === "passed" || status === "failed");
  if (statuses.includes("passed")) return "PASSED";
  if (verdict === null || (statuses.length > 0 && !ran)) return "UNCHECKED";
  return verdict === "PASS" ? "PASSED" : "CHECKED";
}

const UNCHECKED_SENTENCE = "Served; no check result was recorded for this call.";

/** The money strip's middle step on a charged call. */
const CHARGED_STEP: Record<ChargedCheck, ReceiptFlowNode> = {
  PASSED: { label: "Check passed", tone: "success" },
  UNCHECKED: { label: "Served (not checked)", tone: "neutral" },
  CHECKED: { label: "Checked", tone: "neutral" },
};

/* ------------------------------------------------------------ money flow */

export interface ReceiptFlowNode {
  label: string;
  amount?: string;
  tone?: "neutral" | "primary" | "success" | "danger" | "warning" | "teal";
}

const OUTCOME_STEP: Record<Exclude<ReceiptState, "CHECKING" | "CHARGED">, { label: string; tone: ReceiptFlowNode["tone"] }> = {
  NOT_CHARGED: { label: "Check failed", tone: "danger" },
  EMPTY_CONFIRMED: { label: "No results, confirmed", tone: "neutral" },
  MISAPPLIED: { label: "Outside the tool's scope", tone: "warning" },
  SYSTEM_ERROR: { label: "Provider error", tone: "danger" },
  REQUEST_ERROR: { label: "Request rejected", tone: "danger" },
  EXPIRED: { label: "Did not finish in time", tone: "warning" },
  DEBT_OUTSTANDING: { label: "Passed, payment not taken", tone: "warning" },
  DEBT_WRITTEN_OFF: { label: "Written off, provider not paid", tone: "warning" },
  DEBT_VOIDED: { label: "Debt cancelled", tone: "neutral" },
  FORFEITED: { label: "Provider forfeited", tone: "neutral" },
};

/**
 * Where this call's money went, as the receipt's strip draws it:
 * Held $0.10 → Check failed → Released $0.10, or Held → Check passed → Charged.
 */
export function receiptFlow(receipt: Receipt, state: ReceiptState): ReceiptFlowNode[] {
  const held: ReceiptFlowNode = { label: "Held", amount: price(receipt), tone: "primary" };
  if (state === "CHECKING") return [held, { label: "Checking now", tone: "neutral" }];
  // Buyer debt: served and passed, but not collected — still owed, never "released".
  if (state === "DEBT_OUTSTANDING" || state === "DEBT_WRITTEN_OFF") {
    return [held, OUTCOME_STEP[state], { label: "Still owed by you", amount: price(receipt), tone: "warning" }];
  }
  // Voided or forfeited: not charged, the whole hold went back (withheld is zero here).
  if (state === "DEBT_VOIDED" || state === "FORFEITED") {
    return [held, OUTCOME_STEP[state], { label: "Released to you", amount: price(receipt), tone: "teal" }];
  }
  const chargedSomething = receipt.chargedPrice.amount !== "0";
  const step =
    state === "CHARGED"
      ? CHARGED_STEP[chargedCheck(receipt)]
      : !chargedSomething && isFinalNotChargedReceipt(receipt)
        ? notChargedStory(receipt).flowStep
        : OUTCOME_STEP[state];
  if (chargedSomething) {
    return [held, step, { label: "Charged", amount: charged(receipt), tone: "neutral" }];
  }
  return [held, step, { label: "Released to you", amount: formatMoney(receipt.withheld, { decimals: 4 }), tone: "teal" }];
}

/**
 * Whether the relevance stage was reached on this call — it ran, or it was
 * considered and not sampled. Only then does the sampling explanation belong
 * on the receipt; an expired, voided or errored call never got that far, and
 * a tool that declares no relevance check has nothing to explain.
 */
export function relevanceReached(receipt: Receipt): boolean {
  const semantic = receipt.stages.find((s) => s.stage === "SEMANTIC");
  if (!semantic) return false;
  const status = stageStatus(semantic);
  return status !== "not-reached" && status !== "not-applicable";
}

/** A not-charged outcome that is final (not still checking, not charged). */
export function isFinalNotCharged(state: ReceiptState, receipt: Receipt): boolean {
  return state !== "CHECKING" && receipt.chargedPrice.amount === "0";
}

/* ------------------------------------------------------- the one story */

/**
 * Where this call's reports leave its money: `open` for a report covered by
 * the refund guarantee that is being decided (the payment stays held),
 * `closed` for any other report, or `none`.
 */
export type ReceiptReportState = "none" | "open" | "closed";

/** What the timeline needs besides the receipt. */
export interface ReceiptTimelineOptions {
  now?: number;
  /** The closing row of a debt or a forfeit, which replaces the ordinary one. */
  collectionClosing?: ReceiptTimelineRow;
  /** The buyer's reports on this call (`none` when unknown). */
  report?: ReceiptReportState;
}

/** One timeline row before it is stamped: an instant, not a formatted time. */
export interface ReceiptTimelineRow {
  at: string;
  label: string;
  meta?: string;
  tone: "neutral" | "primary" | "success" | "teal";
}

/**
 * The receipt, told once. The headline, the money strip, the check rows and
 * the timeline all read from here, so they cannot disagree: a call charged
 * with no check result never shows "Check passed", and a charged call never
 * closes on "not charged".
 *
 * `collectionClosing` is the closing row of a debt or a forfeit, which needs
 * the debts list (`receipt-collection.ts`); it replaces the ordinary one.
 */
export interface ReceiptStory {
  state: ReceiptState;
  /** The charged headline, on a CHARGED call only. */
  chargedHeadline: string | null;
  /** The not-charged story, on a finished call that was not charged. */
  notCharged: NotChargedStory | null;
  flow: ReceiptFlowNode[];
  checks: StageCheck[];
  timeline: ReceiptTimelineRow[];
}

export function receiptStory(
  receipt: Receipt,
  state: ReceiptState = deriveReceiptState(receipt),
  options: ReceiptTimelineOptions = {},
): ReceiptStory {
  return {
    state,
    chargedHeadline: state === "CHARGED" ? chargedHeadline(receipt) : null,
    notCharged: state !== "CHECKING" && isFinalNotChargedReceipt(receipt) ? notChargedStory(receipt) : null,
    flow: receiptFlow(receipt, state),
    checks: toStageChecks(receipt),
    timeline: receiptTimeline(receipt, state, options),
  };
}

/**
 * The timeline rows: made, held, checked, how it closed, and on a charged
 * call the 1-hour hold — when the refundable hour ends and when the payment
 * goes to the provider. The closing row reads `chargedPrice`: a charged call
 * closes on "Charged", whichever of `settledAt` or `holdReleasedAt` dates it.
 */
export function receiptTimeline(
  receipt: Receipt,
  state: ReceiptState,
  { now = Date.now(), collectionClosing, report = "none" }: ReceiptTimelineOptions = {},
): ReceiptTimelineRow[] {
  const rows: ReceiptTimelineRow[] = [
    { at: receipt.createdAt, label: "Call made", tone: "neutral" },
    { at: receipt.createdAt, label: "Money held", meta: price(receipt), tone: "primary" },
  ];
  if (receipt.evaluatedAt) rows.push({ at: receipt.evaluatedAt, label: "Result checked", tone: "neutral" });

  const closedAt = receipt.settledAt ?? receipt.holdReleasedAt ?? null;
  const chargedSomething = receipt.chargedPrice.amount !== "0";
  if (collectionClosing) {
    rows.push(collectionClosing);
  } else if (closedAt && state !== "CHECKING") {
    rows.push(
      chargedSomething
        ? { at: closedAt, label: "Charged", meta: charged(receipt), tone: "success" }
        : {
            at: closedAt,
            label: state === "EXPIRED" ? "Did not finish in time, hold released" : "Hold released",
            meta: "not charged",
            tone: "teal",
          },
    );
  }

  if (state === "CHARGED" && chargedSomething) rows.push(...holdRows(receipt, now, report));
  return rows;
}

/**
 * The 1-hour hold after a charge, as timeline rows, in time order.
 *
 * Neither row claims more than the receipt knows:
 *  - the hour is "Refundable" only while the backend says a report now is
 *    refunded in full (`refundableIfReportedNow`), or for a report the
 *    guarantee covers (`report === "open"`); otherwise it is just "Hold ends"
 *    (wave-1 audit I1);
 *  - the payment's release is an expectation read from the clock, never
 *    "Paid": collection waits while a report is open, and for a blocked party
 *    or a retry. While a report is open the money is held for it.
 */
function holdRows(receipt: Receipt, now: number, report: ReceiptReportState): ReceiptTimelineRow[] {
  const rows: ReceiptTimelineRow[] = [];
  const reportable = Boolean(receipt.disputeFilingClosesAt);
  const windowEnds = receipt.disputeWindowEndsAt ?? null;
  if (windowEnds) {
    const open = now < Date.parse(windowEnds);
    const refundable = report === "open" || (report === "none" && refundPromiseLive(receipt, now));
    if (!reportable) {
      rows.push({ at: windowEnds, label: open ? "Hold ends" : "Hold ended", tone: "neutral" });
    } else if (open && refundable) {
      rows.push({
        at: windowEnds,
        label: "Refundable until then",
        meta: report === "none" ? "report a bad result for a full refund" : "you reported it",
        tone: "primary",
      });
    } else if (open) {
      rows.push({ at: windowEnds, label: "Hold ends", ...(report === "none" ? {} : { meta: "you reported it" }), tone: "neutral" });
    } else {
      rows.push({ at: windowEnds, label: "Refundable hour ended", ...(report === "none" ? {} : { meta: "you reported it" }), tone: "neutral" });
    }
  }
  const collectable = receipt.collectableAt ?? null;
  if (collectable) {
    if (report === "open") {
      rows.push({ at: collectable, label: "Held for your report until it is decided", meta: charged(receipt), tone: "primary" });
    } else {
      rows.push({
        at: collectable,
        label: now >= Date.parse(collectable) ? "Released to the provider" : "Goes to the provider after the hold",
        meta: charged(receipt),
        tone: "neutral",
      });
    }
  }
  return rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * "Refundable until 18:58 UTC", the shared wording for the 1-hour hold, or
 * null once it has ended (or when the call has none).
 */
export function refundableUntil(receipt: Pick<Receipt, "disputeWindowEndsAt">, now: number = Date.now()): string | null {
  const ends = receipt.disputeWindowEndsAt ?? null;
  if (!ends || now >= Date.parse(ends)) return null;
  return `Refundable until ${formatDateTime(ends, { now, midSentence: true })}`;
}

/* ------------------------------------------------- the not-charged story */

/**
 * Why a call ended without a charge — worked out from the receipt's own fields,
 * so the banner, the money strip, the check rows and the details all tell the
 * same story. The classes, and how the API shows each:
 *
 *   FAILED_CHECKS     REFUNDED, verdict FAIL — a check ran and rejected the result
 *   WRONG_FORMAT      REFUNDED, no verdict record — the response did not match the
 *                     tool's output format, rejected before the pipeline ran
 *   MISAPPLIED        verdict MISAPPLIED — our check did not fit the request
 *   PROVIDER_ERROR    VOIDED, classification SYSTEM_ERROR
 *   REQUEST_REJECTED  VOIDED, classification REQUEST_ERROR
 *   NO_ANSWER         VOIDED, no classification — no provider produced an outcome
 *   EXPIRED           EXPIRED — the hold ran out before the call was resolved
 */
export type NotChargedReason =
  | "FAILED_CHECKS"
  | "WRONG_FORMAT"
  | "MISAPPLIED"
  | "PROVIDER_ERROR"
  | "REQUEST_REJECTED"
  | "NO_ANSWER"
  | "EXPIRED"
  | "UNKNOWN";

export interface NotChargedStory {
  reason: NotChargedReason;
  /** The banner sentence, starting "Not charged." */
  headline: string;
  /** One sentence on what happened to the money. */
  explain: string;
  /** The middle step of the money strip. */
  flowStep: { label: string; tone: ReceiptFlowNode["tone"] };
  /** "Result type" in the details row. */
  resultType: string;
  /** The checks panel's subtitle. */
  checksSummary: string;
  /** The note on a check that did not run, when none failed. */
  notRunNote: string;
}

const RELEASED = "The money was held for the call and then released, so your balance is back where it was.";

export function notChargedReason(receipt: Pick<Receipt, "status" | "classification" | "verdict">): NotChargedReason {
  const verdict = receipt.verdict?.status ?? null;
  if (verdict === "FAIL") return "FAILED_CHECKS";
  if (verdict === "MISAPPLIED") return "MISAPPLIED";
  if (receipt.status === "EXPIRED") return "EXPIRED";
  if (receipt.status === "REFUNDED") return "WRONG_FORMAT";
  if (receipt.status === "VOIDED") {
    if (receipt.classification === "SYSTEM_ERROR") return "PROVIDER_ERROR";
    if (receipt.classification === "REQUEST_ERROR") return "REQUEST_REJECTED";
    return "NO_ANSWER";
  }
  return "UNKNOWN";
}

export function notChargedStory(receipt: Receipt): NotChargedStory {
  const reason = notChargedReason(receipt);
  const failed = receipt.stages.find((stage) => stageStatus(stage) === "failed");
  const failedName = failed ? (STAGE_NAME[failed.stage] ?? "one check").toLowerCase() : null;
  switch (reason) {
    case "FAILED_CHECKS":
      return {
        reason,
        headline: "Not charged. This call failed our checks, so you paid nothing for it.",
        explain: failedName
          ? `The result failed the ${failedName}. ${RELEASED}`
          : `The result failed our checks. ${RELEASED}`,
        flowStep: { label: "Check failed", tone: "danger" },
        resultType: "Data returned, failed our checks",
        checksSummary: "Checks stop at the first failure",
        notRunNote: "not run: an earlier check failed",
      };
    case "WRONG_FORMAT":
      return {
        reason,
        headline: "Not charged. The result did not match the format this tool promises.",
        explain: `The provider sent data, but not in the shape the tool declares, so it failed the first check. ${RELEASED}`,
        flowStep: { label: "Wrong result format", tone: "danger" },
        resultType: "Data in the wrong format",
        checksSummary: "Checks stop at the first failure",
        notRunNote: "not run: an earlier check failed",
      };
    case "MISAPPLIED":
      return {
        reason,
        headline: "Not charged. This request was outside what the tool covers.",
        explain: `Our check did not fit this request, so nobody is blamed and nothing is charged. ${RELEASED}`,
        flowStep: { label: "Outside the tool's scope", tone: "warning" },
        resultType: receipt.classification ? responseClassWords(receipt.classification) : "Data returned",
        checksSummary: "Our check did not fit this request",
        notRunNote: "not run",
      };
    case "PROVIDER_ERROR":
      return {
        reason,
        headline: "Not charged. The provider returned an error instead of a result.",
        explain: `Errors are never charged. ${RELEASED}`,
        flowStep: { label: "Provider error", tone: "danger" },
        resultType: "Provider error, no result",
        checksSummary: "No checks ran: there was no result to check",
        notRunNote: "not run: no result",
      };
    case "REQUEST_REJECTED":
      return {
        reason,
        headline: "Not charged. The provider rejected the request as invalid.",
        explain: `A rejected request is never charged. Check the input your agent sent. ${RELEASED}`,
        flowStep: { label: "Request rejected", tone: "danger" },
        resultType: "Request rejected, no result",
        checksSummary: "No checks ran: there was no result to check",
        notRunNote: "not run: no result",
      };
    case "NO_ANSWER":
      return {
        reason,
        headline: "Not charged. No provider returned a usable result for this call.",
        explain: `The call never got a result, so there was nothing to charge for. ${RELEASED}`,
        flowStep: { label: "No result", tone: "warning" },
        resultType: "No result",
        checksSummary: "No checks ran: there was no result to check",
        notRunNote: "not run: no result",
      };
    case "EXPIRED":
      return receipt.classification === "DATA_RESULT"
        ? {
            reason,
            headline: "Not charged. The provider answered, but the check did not finish in time.",
            explain: `A call we cannot finish checking is never charged. ${RELEASED}`,
            flowStep: { label: "Did not finish in time", tone: "warning" },
            resultType: "Data returned, not checked in time",
            checksSummary: "No checks finished before the time limit",
            notRunNote: "not run: out of time",
          }
        : {
            reason,
            headline: "Not charged. The call did not finish in time.",
            explain: `No result arrived before the time limit. ${RELEASED}`,
            flowStep: { label: "Did not finish in time", tone: "warning" },
            resultType: "No result",
            checksSummary: "No checks ran: there was no result to check",
            notRunNote: "not run: no result",
          };
    default:
      return {
        reason,
        headline: "Not charged. No result was recorded for this call.",
        explain: RELEASED,
        flowStep: { label: "No result", tone: "warning" },
        resultType: "No result",
        checksSummary: "No checks ran on this call",
        notRunNote: "not run",
      };
  }
}

function responseClassWords(classification: string): string {
  if (classification === "EMPTY_RESULT") return "Empty result";
  return "Data returned";
}

/** The terminal statuses that end a call without a charge. */
const NOT_CHARGED_STATUSES = new Set(["REFUNDED", "VOIDED", "EXPIRED"]);

/** True for a finished call that was not charged, from the receipt alone. */
export function isFinalNotChargedReceipt(receipt: Receipt): boolean {
  return NOT_CHARGED_STATUSES.has(receipt.status) && receipt.chargedPrice.amount === "0";
}
