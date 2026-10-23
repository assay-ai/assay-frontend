/**
 * Plain-language names for the enum values the call screens used to print raw.
 *
 * The raw value stays the CSV's and the API's: a provider reconciling the
 * `classification` column needs to match it, so screens show it as a small
 * secondary code beside the name (see `ClassName`), never instead of it.
 * An unknown value is shown as it is rather than hidden.
 */
const CLASS_LABEL: Record<string, string> = {
  PAID_CREDITED: "Paid and credited",
  PAID_AWAITING_REDEMPTION: "Passed, credit on its way",
  PAID_BUYER_DEBT: "Passed, waiting on the buyer",
  PAID_UNCOLLECTED: "Passed, never collected",
  PROVIDER_FORFEITED: "Forfeited by you",
  PAID_UNCREDITED: "Failed our checks",
  FREE: "Free call",
  EXPLORATION: "Trial traffic",
  EXCLUDED: "Excluded from the SLA",
  TEST: "Test call",
  SYSTEM_ERROR: "Endpoint error (5xx or timeout)",
  REQUEST_ERROR: "Request refused (4xx)",
  PENDING: "Still being checked",
};

export function classLabel(name: string): string {
  return CLASS_LABEL[name] ?? name;
}

/** `classification` on a buyer's receipt. */
const RESPONSE_CLASS_LABEL: Record<string, string> = {
  DATA_RESULT: "Data returned",
  SYSTEM_ERROR: "Provider error",
  REQUEST_ERROR: "Request error",
};

/** `Data returned`: the plain name alone, for a buyer's receipt. */
export function responseClassLabel(name: string): string {
  return RESPONSE_CLASS_LABEL[name] ?? name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, " ");
}

/** `Data returned · DATA_RESULT`: the name, then the API's own value as the code. */
export function responseClassText(name: string): string {
  const label = RESPONSE_CLASS_LABEL[name];
  return label ? `${label} · ${name}` : name;
}

/** A receipt's outcome (`ReceiptState`), for the state cards on a buyer's receipt. */
const RECEIPT_STATE_LABEL: Record<string, string> = {
  CHECKING: "Still being checked",
  EMPTY_CONFIRMED: "No results, confirmed",
  MISAPPLIED: "Outside the tool's scope",
  SYSTEM_ERROR: RESPONSE_CLASS_LABEL.SYSTEM_ERROR,
  REQUEST_ERROR: RESPONSE_CLASS_LABEL.REQUEST_ERROR,
  EXPIRED: "Expired",
  DEBT_OUTSTANDING: "Payment not collected yet",
  DEBT_WRITTEN_OFF: "Written off for the provider, still owed",
  DEBT_VOIDED: "Voided, not charged",
  FORFEITED: "Forfeited by the provider",
};

/** The card's title; the raw value is shown beside it as the small code. */
export function receiptStateLabel(code: string): string {
  return RECEIPT_STATE_LABEL[code] ?? code;
}

/** The sentences the settlement path writes into the CSV's `reason` column. */
const REASON_LABEL: Record<string, string> = {
  "verification: judged and settled by the worker": "Passed our checks",
  "verification: judged and refunded by the worker": "Failed our checks — the buyer was refunded",
  "verification: judged void by the worker — no charge, no strike":
    "Voided by our checks — no charge, and it does not count against you",
  "mcp: forwarded to the provider router": "Sent to your endpoint",
  "mcp: forwarded to asynchronous verification": "Being checked",
  "mcp: provider outcome was not a DATA_RESULT": "Your endpoint did not return data",
  "mcp: no provider outcome — the call never reached one": "The call never reached your endpoint",
};

/**
 * What a PROVIDER_FORFEITED row carries in `reason`: `provider_forfeit:` and
 * the cause, a program error or a block, as the redemption sweep wrote it.
 */
const FORFEIT_PREFIX = "provider_forfeit:";

const FORFEIT_CAUSE_LABEL: Record<string, string> = {
  ProviderBelowMinimumStake: "Forfeited — your stake was below the minimum",
  ProviderBlocked: "Forfeited — your provider account was blocked",
  PayeeBlocked: "Forfeited — your payout address was blocked",
  PayeeBlockedOnChain: "Forfeited — your payout address was blocked on chain",
};

/**
 * What a PAID_BUYER_DEBT row carries in `reason` (`buyer_debt:` and the lapse
 * cause), a PAID_UNCOLLECTED row (`uncollected:` and the cause), and a
 * voided debt's PAID_UNCREDITED row (`voided:` and the late verdict).
 */
const BUYER_DEBT_PREFIX = "buyer_debt:";
const VOIDED_PREFIX = "voided:";
const UNCOLLECTED_PREFIX = "uncollected:";

export function reasonLabel(reason: string): string {
  if (reason.startsWith(BUYER_DEBT_PREFIX)) {
    const cause = reason.slice(BUYER_DEBT_PREFIX.length).trim();
    const why = debtCauseText(cause);
    return `The buyer's payment could not be collected yet (${why}) — paid to you once the buyer settles it`;
  }
  if (reason.startsWith(UNCOLLECTED_PREFIX)) {
    const rest = reason.slice(UNCOLLECTED_PREFIX.length).trim();
    return `Never collected: the buyer did not settle it in time (${debtCauseText(rest)}) — written off, but the buyer still owes it; you are paid if they settle`;
  }
  if (reason.startsWith(VOIDED_PREFIX)) {
    return "The buyer's payment had lapsed, and the call then did not pass our checks — voided: not paid, and nobody owes it";
  }
  if (reason.startsWith(FORFEIT_PREFIX)) {
    const cause = reason.slice(FORFEIT_PREFIX.length).trim();
    return FORFEIT_CAUSE_LABEL[cause] ?? (cause ? `Forfeited — ${cause}` : "Forfeited");
  }
  return REASON_LABEL[reason] ?? reason;
}

/**
 * Why a voucher lapsed, in plain words. The cause is the chain refusal the
 * redemption came back with, or the backend's own lapse cause.
 */
const DEBT_CAUSE_TEXT: Record<string, string> = {
  VoucherExpired: "the payment voucher expired before it could be collected",
  VerdictPastRedemptionDeadline: "the check finished after the payment voucher expired",
  DelegateIsRevoked: "the agent key that signed it was revoked",
  DelegateIsExpired: "the agent key that signed it had expired",
  DelegateNotActive: "the agent key that signed it was no longer active",
  DelegateVoucherExceedsPerCallLimit: "it was over the agent key's per-payment cap",
  DelegateWindowLimitExceeded: "it was over the agent key's spending cap for the period",
  VoucherExceedsPerCallLimit: "it was over the per-payment limit set on the escrow",
  EscrowWindowLimitExceeded: "it was over the escrow's spending limit for the period",
  EscrowInsufficient: "the escrow did not hold enough funds",
  VoucherSeqNotIncreasing: "a later payment was collected first",
  VoucherSeqUsed: "this payment had already been collected",
  VoucherSeqGapTooLarge: "its payment number was too far ahead of the escrow's",
  SignerIsNotPayer: "it was not signed by the paying wallet or its agent key",
  InvalidSignature: "its signature could not be checked",
};

/**
 * The prefixes a recorded cause may carry (`uncollected:VoucherExpired` on a
 * written-off debt, `buyer_debt:…`, `provider_forfeit:…`, `voided:…`). The
 * words are for the cause after it.
 */
const CAUSE_PREFIXES = [UNCOLLECTED_PREFIX, BUYER_DEBT_PREFIX, FORFEIT_PREFIX, VOIDED_PREFIX];

function bareCause(cause: string): string {
  let key = cause.trim();
  for (let stripped = true; stripped; ) {
    stripped = false;
    for (const prefix of CAUSE_PREFIXES) {
      if (key.startsWith(prefix)) {
        key = key.slice(prefix.length).trim();
        stripped = true;
      }
    }
  }
  return key;
}

export function debtCauseText(cause: string | null | undefined): string {
  const key = bareCause(cause ?? "");
  if (!key || key === "unknown") return "the reason was not recorded";
  return DEBT_CAUSE_TEXT[key] ?? key;
}
