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
  PLATFORM_ABSORBED: "Covered by the platform",
  PAID_UNCREDITED: "Rejected by our checks",
  FREE: "Free call",
  EXPLORATION: "Trial traffic",
  EXCLUDED: "Excluded from the SLA",
  TEST: "Test call",
  SYSTEM_ERROR: "Endpoint error",
  REQUEST_ERROR: "Bad request",
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

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}
