import type { StageCheck, StageCheckStatus } from "@/components/ui/stage-list";
import { formatMoney, toDecimal } from "@/utils/money";
import { presentVerdict } from "@/utils/verdict";

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
  SEMANTIC: "Relevance judgement",
};

/**
 * Eight wire statuses collapse onto the four the design draws.
 *
 * The load-bearing half of this map is the default: ANY status that is not
 * literally PASSED, FAILED or SKIPPED becomes "not reached". A stage that did
 * not run must never render as a tick — the API says so itself ("`passed` is
 * the only status that may ever be rendered as a tick"), and on this product a
 * false tick is a claim that money was checked when it was not.
 */
const STAGE_STATUS: Record<WireStageStatus, StageCheckStatus> = {
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "not-sampled",
  NOT_REACHED: "not-reached",
  NOT_APPLICABLE: "not-reached",
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

export function toStageChecks(receipt: Receipt): StageCheck[] {
  return receipt.stages.map((stage) => {
    const status = stageStatus(stage);
    const sampledNote =
      stage.stage === "SEMANTIC" && status === "not-sampled"
        ? receipt.sampling.display ?? undefined
        : undefined;

    return {
      id: stage.stage,
      name: STAGE_NAME[stage.stage] ?? stage.stage,
      status,
      note: sampledNote ?? stage.note ?? STAGE_FALLBACK_NOTE[stage.stage],
      detail: stage.detail ?? undefined,
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

  return receipt.chargedPrice.amount !== "0" ? "CHARGED" : "NOT_CHARGED";
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
      "This call was served and passed, but its payment could not be collected from your escrow. The price is still held there. Sign to settle it from the banner above (if you signed already, it is being collected): paid calls are paused until it is collected, and free calls still work.",
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
  const shown = presentVerdict(receipt.verdict?.status ?? null).shownAs;
  const sentence = shown.endsWith(".") ? shown : `${shown}.`;
  return `Charged ${amount}. ${sentence}`;
}

/**
 * The not-charged receipt headline.
 *
 * The design writes one sentence — "Not charged. This call failed our checks,
 * so you paid nothing for it." — which is the FAIL wording. A call can also be
 * uncharged because it expired, or because it was never judged, and saying "it
 * failed our checks" about those would be false. So FAIL keeps the design's
 * sentence exactly and everything else takes "Not charged." followed by
 * `presentVerdict()`'s sentence, which is the only thing allowed to describe a
 * verdict at all.
 */
export function notChargedHeadline(receipt: Receipt): string {
  if (receipt.verdict?.status === "FAIL") {
    return "Not charged. This call failed our checks, so you paid nothing for it.";
  }
  const shown = presentVerdict(receipt.verdict?.status ?? null).shownAs;
  return `Not charged. ${shown.endsWith(".") ? shown : `${shown}.`}`;
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
  return "The relevance judgement is the only stage that did not run, and it is sampled — not skipped.";
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
      body: `Relevance judgement runs on every call at ${listed}, so nothing on this receipt is sampled.`,
      tail: "",
    };
  }
  // The default tail says tools at $0.05 and above are judged on every call.
  // This call is at least that price and WAS sampled, so the tail would
  // contradict the paragraph above it (BUG-R2-B1-02).
  const tail = toDecimal(receipt.listedPrice).gte("0.05") ? { tail: "" } : {};
  return {
    ...tail,
    body: `Relevance judgement is the only sampled stage. At ${listed} a call, judging every one would cost more than the call itself. Instead we sample, and the provider’s stake covers the rest: if their measured quality falls below what they published, they are slashed and you are compensated for what you spent in that window.`,
  };
}
