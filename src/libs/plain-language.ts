import { tooManyRequestsSentence } from "@/libs/ApiClient";
import { NOTIFICATION_EVENT_LABEL } from "@/components/g31/notification-catalogue";

/**
 * The plain-language dictionary: every machine key a person can meet on a
 * screen — check rules, verdict reasons, error codes, audit actions, events —
 * as a short sentence. Raw keys belong in CSVs, "Details" disclosures and raw
 * JSON, never as the visible label.
 *
 *   plainRule("MIN_ARRAY_LENGTH", { min: 3 })   → "Returns at least 3 results"
 *   plainError("SPEND_LIMIT_EXCEEDED")          → "This call would go over your spend limit."
 *   plainAuditAction("credential.revoked")       → "Agent key revoked"
 *   plain("quorum_failures_at_least")            → "Enough checks failed to decide the result"
 *   plain("SOMETHING_NEW")                       → "Something new"   (safe fallback)
 *
 * **Reuse before adding.** Verdict sentences live in `utils/verdict.ts`
 * (`presentVerdict`), call classes in `features/call-classes/labels.ts`,
 * notification events in `components/g31/notification-catalogue.ts`, chain
 * refusals in `libs/chains/status-labels.ts`. This file covers the rest and
 * delegates to those for theirs.
 *
 * ## Related helpers (do not duplicate them)
 *
 * - Money: `formatMoney(money, { decimals })` / `formatDecimal` in
 *   `utils/money.ts` (truncates, never rounds); `formatLimit` (2 decimals,
 *   widens below a cent) and `formatPrice` (4 decimals, per-call prices) in
 *   `components/g31/format.ts`. Never `Number(amount) / 1e6`.
 * - Chains: `chainName(chainId, chains)` in `utils/chain.ts`, or the
 *   `useChainName()` hook, which wires in `GET /chains`.
 * - Times: `formatDateTime` / `utcTitle` in `libs/utc-time.ts`, or the
 *   `<UtcTime>` component.
 */

/* ------------------------------------------------------------------------
 * Fallback
 * ---------------------------------------------------------------------- */

/**
 * `MIN_ARRAY_LENGTH` → "Min array length", `slash_proposal.suspended` →
 * "Slash proposal suspended", `passThreshold` → "Pass threshold". For a key no
 * dictionary knows yet: readable, and still recognisably the same key.
 */
export function humanize(key: string | null | undefined): string {
  if (!key) return "";
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._:/-]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word.toLowerCase()));
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const ACRONYMS = new Set(["URL", "MCP", "SLA", "API", "ID", "JSON", "HTTP", "DNS", "TLS", "RPS", "UTC", "EVM"]);

/* ------------------------------------------------------------------------
 * Verification rules
 * ---------------------------------------------------------------------- */

type RuleParams = {
  min?: number;
  max?: number;
  fields?: readonly string[];
  maxAgeMs?: number;
  schemes?: readonly string[];
  path?: string;
};

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A check rule as what it promises the buyer. `params` makes it specific. */
export function plainRule(type: string, params: RuleParams = {}): string {
  switch (type) {
    case "MIN_ARRAY_LENGTH": {
      const min = params.min ?? 1;
      return min <= 1 ? "Returns at least one result" : `Returns at least ${min} results`;
    }
    case "REQUIRED_FIELDS":
      return params.fields?.length
        ? `Every result includes ${list(params.fields.map((f) => `“${f}”`))}`
        : "Every result includes the required fields";
    case "FRESHNESS":
      return params.maxAgeMs ? `Data is no older than ${duration(params.maxAgeMs)}` : "Data is recent enough";
    case "VALUE_RANGE":
      if (params.min !== undefined && params.max !== undefined) return `Values fall between ${params.min} and ${params.max}`;
      if (params.min !== undefined) return `Values are at least ${params.min}`;
      if (params.max !== undefined) return `Values are at most ${params.max}`;
      return "Values fall in the expected range";
    case "VALID_URL":
      return params.schemes?.length && !(params.schemes.length === 2 && params.schemes.includes("https"))
        ? `Links are valid ${list([...params.schemes])} URLs`
        : "Links are valid web addresses";
    case "NO_DUPLICATES":
      return "No result appears twice";
    default:
      return humanize(type);
  }
}

/** Why a rule failed or did not run (`rule.code` on evidence). */
const RULE_CODES: Record<string, string> = {
  // Verdict reason codes as the verdict feed sends them (upper case).
  FRESHNESS_STALE: "The data was older than allowed",
  VALUE_RANGE_OUT_OF_BOUNDS: "A value was outside the allowed range",
  REQUIRED_FIELDS_MISSING: "A required field was missing",
  MIN_ARRAY_LENGTH_NOT_MET: "Too few results",
  INVALID_URL: "A link was not a valid address",
  DUPLICATE_VALUES: "The same value appeared more than once",
  stale_timestamp: "The data was older than allowed",
  future_timestamp: "A timestamp was in the future",
  missing_timestamp: "A timestamp was missing",
  missing_value: "A required value was missing",
  missing_field: "A required field was missing",
  null_field: "A required field was empty",
  insufficient_results: "Too few results",
  too_few_values: "Too few values",
  out_of_range: "A value was outside the allowed range",
  invalid_url: "A link was not a valid address",
  disallowed_scheme: "A link used a scheme that is not allowed",
  duplicate_values: "The same value appeared more than once",
  gated_off: "Did not apply to this request",
  no_items: "There was nothing to check",
  path_not_found: "The check points at a field the response does not have",
  invalid_selector: "The check points at a field the response does not have",
  not_a_collection: "Expected a list, got something else",
  not_a_number: "Expected a number, got something else",
  not_a_string: "Expected text, got something else",
  not_a_timestamp: "Expected a date, got something else",
  not_an_object: "Expected an object, got something else",
  not_comparable: "The values could not be compared",
  no_bounds_declared: "The range check has no limits set",
  unknown_rule_type: "This check type is not recognised",
  empty_result: "The tool returned no results",
  empty_result_confirmed: "No results, and a second source confirmed none exist",
  empty_result_unverified: "No results, not confirmed by a second source",
  no_schema_declared: "The tool has no response shape to check against",
  schema_stage_error: "The response shape could not be checked",
  irrelevant_response: "The answer did not match the question",
  incomplete_response: "The answer was incomplete",
  incoherent_response: "The answer did not make sense",
  verifier_no_result: "A checker gave no result",
  no_clause_matched: "No rule decided the result, so the default applied",
};

/** Rule outcomes and pipeline stage states. */
const OUTCOMES: Record<string, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  NOT_APPLICABLE: "Did not apply",
  EMPTY_COLLECTION: "No results to check",
  MISAPPLIED: "Did not fit this request",
  NOT_REACHED: "Not reached",
  NOT_IMPLEMENTED: "Not checked",
  SKIPPED: "Not sampled",
  UNAVAILABLE: "Checker unavailable",
  ABSTAIN: "No opinion",
};

/** What decided a verdict (`quorum_<trigger>` reason codes and the triggers themselves). */
const DECISIONS: Record<string, string> = {
  FAILURES_AT_LEAST: "Enough checks failed to decide the result",
  FAILED_FRACTION_AT_LEAST: "A large enough share of checks failed",
  VERIFIER_FAILED: "A deciding check failed",
  MISAPPLIED_AT_LEAST: "The checks did not fit the request, so the call was voided",
  VOTES_BELOW: "Too few checks ran to judge fully",
};

/** `quorum_failures_at_least` → "Enough checks failed to decide the result". */
export function plainDecision(code: string): string {
  const trigger = code.replace(/^quorum_/i, "").toUpperCase();
  return DECISIONS[trigger] ?? RULE_CODES[code] ?? humanize(code);
}

/** `w_4482` → "Window 4482". */
export function windowLabel(key: string): string {
  const match = /^w_(\d+)$/i.exec(key);
  return match ? `Window ${match[1]}` : humanize(key);
}

/** Policy and SLA settings, as labels. */
const TERMS: Record<string, string> = {
  passThreshold: "Score needed to pass",
  slaFailureRate: "Promised maximum failure rate",
  declaredFailureRate: "Promised maximum failure rate",
  observedFailureRate: "Failure rate so far",
  minVerifiedCalls: "Checked calls needed before a penalty",
  totalCalls: "Calls",
  verifiedCalls: "Checked calls",
  failedCalls: "Failed calls",
  pricingMode: "Pricing",
  timeoutMs: "Timeout",
  SHADOW: "Observing only — no money moves",
  ACTIVE: "Active",
  DRAFT: "Draft",
  WITHDRAWN: "Withdrawn",
  ARCHIVED: "Archived",
  WITHIN_SLA: "Within the promise",
  INSUFFICIENT_SAMPLE: "Not enough checked calls to judge",
  BREACH_PROPOSED: "Penalty proposed",
  BELOW_SAMPLE_GATE: "Not enough calls yet",
  PROJECTED_BREACH: "On course to break the promise",
  WARNING: "Warning",
  CRITICAL: "Critical",
  OPEN: "Open",
  CLOSED: "Closed",
  PASS_UNVERIFIED: "Empty answers are paid",
};

/* ------------------------------------------------------------------------
 * Calls and money
 * ---------------------------------------------------------------------- */

const RESPONSE_CLASSES: Record<string, string> = {
  DATA_RESULT: "The provider returned data",
  DATA_FAIL: "The provider returned data that failed our checks",
  SYSTEM_ERROR: "The provider's system failed — no charge",
  REQUEST_ERROR: "The request was not valid for this tool — no charge",
};

const CLASSIFICATION_REASONS: Record<string, string> = {
  OK: "Normal reply",
  TRANSPORT_TIMEOUT: "The provider took too long to answer",
  TRANSPORT_CONNECTION_REFUSED: "The provider's server was not reachable",
  TRANSPORT_CONNECTION_RESET: "The connection to the provider dropped",
  TRANSPORT_DNS_FAILURE: "The provider's address did not resolve",
  TRANSPORT_TLS_FAILURE: "A secure connection to the provider failed",
  TRANSPORT_BODY_TRUNCATED: "The provider's reply was cut off",
  UPSTREAM_RATE_LIMITED: "The provider was rate limiting requests",
  UPSTREAM_SERVER_ERROR: "The provider's server returned an error",
  UPSTREAM_UNEXPECTED_STATUS: "The provider answered with an unexpected status",
  REQUEST_REJECTED: "The provider said the request was invalid",
  BODY_EMPTY: "The provider sent an empty reply",
  BODY_NOT_JSON: "The provider's reply was not readable data",
  BODY_ERROR_ENVELOPE: "The provider replied with an error message",
  BODY_PREDICATE_MATCHED: "The reply matched the tool's own error pattern",
  MAPPING_FAULT_AGENT: "The agent's request could not be translated",
  MAPPING_FAULT_PLATFORM: "Assay could not translate the reply",
  MAPPING_FAULT_PROVIDER: "The provider's reply could not be translated",
};

const STATUSES: Record<string, string> = {
  CREATED: "Started",
  FUNDS_SECURED: "Money held",
  PROVIDER_EXECUTING: "Waiting for the provider",
  VERIFYING: "Being checked",
  SETTLED: "Charged",
  REFUNDED: "Not charged — failed our checks",
  VOIDED: "Not charged",
  EXPIRED: "Expired — money released",
  RELEASED: "Released",
  COMMITTED: "Charged",
  SETTLING: "Confirming",
  PENDING: "Pending",
  FAILED_VERIFICATION: "Failed our checks",
  PROVIDER_OR_PLATFORM_ERROR: "Provider or platform error",
  PAID: "Paid",
  FREE: "Free",
  TEST: "Test call",
  EXPLORATION: "Trial traffic (the buyer pays as usual; Assay pays only for the checks)",
  PAUSED: "Paused",
  SUSPENDED: "Suspended",
  UNBONDING: "Leaving — stake unlocking",
};

const INELIGIBILITY: Record<string, string> = {
  BINDING_NOT_ACTIVE: "The listing is not live",
  PROVIDER_UNKNOWN: "The provider was not found",
  PROVIDER_NOT_ACTIVE: "The provider is suspended or leaving",
  PROVIDER_EXCLUDED: "This provider was already tried for this call",
  CHAIN_NOT_SETTLEABLE: "You and the provider share no chain to settle on",
  BUYER_WITHDRAWING: "Your funds are being withdrawn",
  PAYOUT_ACCOUNT_UNPROVED: "The provider has not proven their payout address",
  PAYOUT_ENROLMENT_NOT_ACTIVE: "The provider is not set up on this chain",
  STAKE_UNKNOWN: "The provider's stake could not be read",
  STAKE_BELOW_MINIMUM: "The provider's stake is below the minimum",
  STAKE_ASSET_MISMATCH: "The provider's stake is in the wrong currency",
  STAKE_GRACE_EXPIRED: "The provider did not top up their stake in time",
  CEILING_REACHED: "The provider's call limit was reached",
  PROVIDER_SLASH_HOLD: "The provider is on hold during a penalty case",
  MAX_VOUCHER_AMOUNT: "Over the per-call payment limit",
  MAX_PER_WINDOW: "Over the payment limit for this period",
  VALID_UNTIL: "The payment permission expired",
  REVOKED: "Revoked",
  SLASH_WINDOW_FULL: "Too many penalties are open at once",
  STAKE_FULLY_RESERVED: "All stake is reserved for open penalties",
  BONDED_BELOW_MINIMUM: "Stake is below the minimum",
};

/* ------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------- */

/**
 * API error codes as one sentence each. Keys are listed without the module
 * prefix where the backend has one (`MCP_`, `PAYMENT_`…), and looked up both
 * ways, so `SPEND_LIMIT_EXCEEDED` and `MCP_SPEND_LIMIT_EXCEEDED` both work.
 */
const ERRORS: Record<string, string> = {
  AUTH_WALLET_NOT_LINKED: "Your wallet is still being linked to your account. Try again in a minute.",
  AUTH_AGENT_SUSPENDED: "This agent is suspended.",
  // Suspension left the product (2026-10-20): an org the old code still names is a blocked one (BUG-X-02).
  AUTH_ORGANIZATION_SUSPENDED: "Your account is blocked by Assay. Contact support.",
  AUTH_HUMAN_SESSION_REQUIRED: "Sign in as yourself to do this; an agent key cannot.",
  ACCOUNT_BLOCKED: "This account is blocked. Contact support.",
  AGENT_KEYS_HIDDEN: "Agent keys show when you sign in as yourself; an agent key cannot list them.",
  SPEND_LIMIT_EXCEEDED: "This call would go over your spend limit.",
  VELOCITY_LIMIT_EXCEEDED: "Spending too fast: this call was refused. Calls are allowed again in a moment.",
  POLICY_AGENT_PAUSED: "This agent is paused by its budget.",
  APPROVAL_REQUIRED: "This call needs a person's approval.",
  TOOL_NOT_ALLOWED: "This agent isn't allowed to use this tool.",
  TOOL_NOT_IN_TOOLSET: "This tool is not part of this server.",
  NO_PROVIDER_MATCHES_RULES: "No provider fits your limits.",
  TOOL_REMOVED: "This tool was removed by its maker.",
  CONTRACT_VERSION_RETIRED: "This version of the tool was retired. Use its newer version.",
  UNSUPPORTED_INPUT_FIELD: "No provider this agent may use accepts one of the inputs it sent.",
  QUOTA_EXCEEDED: "The free calls are used up.",
  CREDENTIAL_INVALID: "This agent key is not valid.",
  INSUFFICIENT_FUNDS: "Not enough balance for this call.",
  VOUCHER_ADMISSION_PAUSED: "Paid calls are paused for a moment. Try again shortly.",
  VOUCHER_ESCROW_LIMIT_EXCEEDED: "This is over your escrow's safety cap.",
  VOUCHER_DELEGATE_LIMIT_EXCEEDED: "This is over the agent's payment permission.",
  VOUCHER_DELEGATE_INACTIVE: "The agent's payment permission is not active.",
  VOUCHER_DELEGATE_NOT_BOUND: "The agent key is not linked to a payment permission.",
  ESCROW_NOT_OPEN: "Open your escrow first.",
  WITHDRAWAL_PENDING: "A withdrawal is in progress, so paid calls are paused.",
  NO_SETTLEABLE_CHAIN: "You and this provider share no chain to pay on.",
  PROVIDER_SLASH_HOLD: "This provider is on hold during a penalty case.",
  DEPOSIT_BELOW_MINIMUM: "The deposit is below the minimum.",
  DEPOSIT_TRANSACTION_ALREADY_CLAIMED: "This deposit was already credited.",
  DEPOSIT_ACCOUNT_NOT_LINKED: "The wallet you deposited from is not linked to your account.",
  IDEMPOTENCY_KEY_REUSED: "This request was already sent.",
  UNSETTLED_VOUCHERS_AT_RISK: "This change would leave recent payments unable to settle.",
  WITHDRAWALS_FROZEN: "Withdrawals are frozen for now.",
  WITHDRAWAL_NOT_YET_AVAILABLE: "The withdrawal is not available yet.",
  WITHDRAWAL_DESTINATION_INVALID: "The destination address is not valid.",
  DELEGATION_NOT_ACTIVE: "The payment permission is not active.",
  UNBONDING_NOT_MATURED: "The stake is still unlocking. You can withdraw it once the waiting period ends.",
  STAKE_BELOW_MINIMUM: "The stake is below the required minimum.",
  CHAIN_NOT_ENROLLED: "Set up this chain first.",
  BINDING_NOT_EDITABLE: "This listing cannot be edited right now.",
  BINDING_TOOL_UNKNOWN: "This tool is not in the catalogue any more. Pick another one.",
  MAPPING_INVALID: "This mapping is not valid yet. Check the highlighted row.",
  BINDING_CHAIN_STAKE_BELOW_MINIMUM: "There is not enough stake on this chain.",
  PUBLISH_CHECKS_FAILED: "The listing did not pass the checks before going live.",
  BINDING_PRICE_NOT_POSITIVE: "The price must be above zero.",
  BINDING_FREE_LIMIT_TOO_LARGE: "The free allowance is too large.",
  CONNECTIVITY_CHECK_FAILED: "We could not reach your endpoint.",
  TERMS_VERSION_MISMATCH: "Accept the latest terms to continue.",
  CONTACTS_NOT_DISTINCT: "Use a different email for the second person: it must be someone else's inbox.",
  PAYOUT_CHALLENGE_ALREADY_USED: "That signing request was already used. Sign again.",
  PROVIDER_SUSPENDED: "This provider account is suspended.",
  STAKE_CHALLENGE_EXPIRED: "The signing request expired. Start again.",
  PAYOUT_CHALLENGE_EXPIRED: "The signing request expired. Start again.",
  STAKE_SIGNATURE_INVALID: "The signature did not match. Sign with the right wallet.",
  PAYOUT_SIGNATURE_INVALID: "The signature did not match. Sign with the right wallet.",
  NO_ELIGIBLE_BINDING: "No provider can serve this tool right now.",
  ALL_BINDINGS_FAILED: "Every provider failed this call. Nothing was charged.",
  ARGUMENTS_INVALID: "The tool's inputs are not valid.",
  INTERNAL_ERROR: "Something went wrong on our side. Try again in a moment; if it keeps happening, contact support.",
  DISPUTE_NOT_WITHDRAWABLE: "This dispute can no longer be withdrawn.",
  DISPUTE_ALREADY_ACKNOWLEDGED: "This dispute was already acknowledged.",
  SLASH_PROPOSAL_RESPONSE_WINDOW_CLOSED: "It is too late to dispute this penalty.",
  SLASH_PROPOSAL_NOT_DISPUTABLE: "This penalty cannot be disputed.",
  SLASH_PROPOSAL_ALREADY_DISPUTED: "This penalty is already disputed.",
  SLASH_DISPUTE_ON_CHAIN_ONLY: "Dispute this penalty on chain.",
  SLASH_TIMELOCK_NOT_ELAPSED: "The waiting period has not passed yet.",
  SLASH_SECOND_SIGNATURE_REQUIRED: "A second reviewer has to sign this.",
  OPERATOR_AUTHORITY_EXCEEDED: "This is above your approval limit. Ask an operator with a higher limit.",
  OPERATOR_APPROVER_AUTHORITY_EXCEEDED: "This is above the approver's limit.",
  OPERATOR_SECOND_APPROVER_REQUIRED: "A second operator has to approve this.",
  OPERATOR_SELF_APPROVAL_REFUSED: "You cannot approve your own request.",
  OPERATOR_ROLE_REQUIRED: "Your role cannot do this.",
  OPERATOR_NOT_AUTHORIZED: "Your role cannot do this.",
  OPERATOR_AUTH_RATE_LIMITED: "Too many sign-in attempts. Wait a minute.",
  OPERATOR_BLOCK_ALREADY_ACTIVE: "This is already blocked.",
  OPERATOR_BLOCK_ALREADY_LIFTED: "This is already unblocked.",
  OPERATOR_APPROVAL_NOT_PENDING: "This request was already decided.",
  VERIFICATION_EVIDENCE_PACK_TAMPERED: "The evidence failed its integrity check.",
  CHAIN_PROGRAM_PAUSED: "The contracts are paused. Try again after they resume.",
  CHAIN_ADDRESS_BLOCKED: "This address is blocked on chain.",
  CHAIN_TRANSACTION_FAILED: "The transaction failed on chain. Your balance did not change, though the network fee may have been spent.",
  CHAIN_RAIL_NOT_OFFERED:
    "This chain currently serves free calls only, so this paid action is not available on it. Nothing was charged.",
  DEBT_OUTSTANDING:
    "Paid calls are paused: your escrow owes for a call your agent already made. Settle it from the banner at the top. Free calls still work.",
  DEBT_REPLACEMENT_PENDING:
    "This call is signed already and its payment is being collected (about a minute). Nothing to sign.",
  VALIDATION_FAILED: "Some of the details are not valid.",
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have access to this.",
  NOT_FOUND: "We could not find this.",
  CONFLICT: "This changed in the meantime. Reload and try again.",
  TOO_MANY_REQUESTS: "Too many requests. Wait a moment and try again.",
  SERVICE_UNAVAILABLE: "Assay is briefly unavailable. Try again shortly.",
  ERR_NETWORK: "We could not reach Assay. Check your connection.",
  TOOLSET_NOT_FOUND: "This tool set was not found. It may have been deleted.",
  TOOLSET_SLUG_TAKEN: "Another of your tool sets already uses this address.",
  TOOLSET_INVALID: "This tool set is not valid: check its tools and provider rules.",
  TOOLSET_LIMIT_EXCEEDED: "You reached a limit: 200 tools per set, 5 always loaded, 100 sets per account.",
  TOOLSET_ACCESS_INVALID: "This change to what the agent can use is not valid.",
  TOOLSET_REFUSED_CALL_NOT_FOUND: "This refused call was not found.",
  TOOLSET_HANDLE_INVALID: "Use 3–24 lowercase letters, digits or “-” for a public name, starting with a letter.",
  TOOLSET_HANDLE_TAKEN: "This public name is taken. Try another.",
  TOOLSET_HANDLE_LOCKED: "Your public name is in use by a shared tool set. Ask support to rename it.",
  TOOLSET_HANDLE_REQUIRED: "Choose a public name before sharing.",
  TOOLSET_HANDLE_CLAIM_REFUSED: "Add funds once before you choose a public name.",
  TOOLSET_HANDLE_NOT_FOUND: "No one uses this public name.",
  TOOLSET_SHARING_REFUSED: "This tool set can't be changed that way right now.",
  TOOLSET_NOT_PUBLISHABLE: "Some tools in this set can't be shared. Remove them and try again.",
  TOOLSET_VERSION_NOT_FOUND: "This version of the tool set does not exist.",
  TOOLSET_SLUG_LOCKED: "A tool set that has been shared keeps its address.",
  TOOLSET_REPORT_DUPLICATE: "Your team already reported this. Assay is looking at it.",
  TOOLSET_REPORT_TARGET_NOT_FOUND: "There is nothing here to report.",
  CREDENTIAL_IN_QUERY:
    "Don't put keys in the URL. URLs are logged by proxies, CDNs and servers and leak through browser history. Add it under Authentication → API key instead.",
  SECRET_IN_MAPPING:
    "This looks like a secret. Mappings are stored in plain text — add it under Authentication → API key instead.",
  INVALID_CREDENTIAL_HEADERS: "Some header names or values aren't allowed. Check the highlighted rows.",
  CREDENTIAL_ORIGIN_MISMATCH: "These headers belong to an old address. Enter them again for the current endpoint.",
  CREDENTIAL_VAULT_UNAVAILABLE: "We can't reach the key store right now. Your API wasn't called. Try again in a minute.",
  CREDENTIAL_VAULT_NOT_CONFIGURED:
    "Key storage isn't set up on this server, so headers can't be saved. Nothing was stored. Tell Assay support.",
  ENDPOINT_PORT_NOT_SUPPORTED:
    "Your API uses a port Assay can't reach. Use port 443 or one of 8443, 2053, 2083, 2087, 2096.",
  RESERVED_MAPPING_HEADER: "Headers starting with x-assay- are set by Assay. Remove this header from your mapping.",
  CREDENTIALS_REQUIRED_FOR_AUTH_MODE: "Add your API key headers for the live address first, then switch to API key.",
  CREDENTIAL_ORIGIN_LIVE: "Your live tool uses these headers. Publish a new address first, then remove them.",
  URL_NOT_RECOGNISED: "We couldn't read this URL. Start a new one.",
  // Codes added by the e2e run 2 group-3 backend fixes (be-g3a / be-g3b).
  PAYLOAD_TOO_LARGE: "This is too large to send. Make it shorter and try again.",
  ACCOUNT_AGENT_NOT_FOUND: "This agent was not found in your account. It may have been deleted.",
  STAKE_INSUFFICIENT_BONDED: "That is more than your staked amount. Enter at most what is staked.",
  STAKE_NOTHING_WITHDRAWABLE:
    "Nothing is ready to withdraw yet: unstaked money can be withdrawn once its waiting period ends.",
  TOO_MANY_MAPPING_HEADERS: "This mapping has too many headers. Remove some and try again.",
  TOOLSET_ORGANIZATION_NOT_FOUND: "No organization has this id. Check it and try again.",
  MCP_URL_NOT_FOUND: "This server URL does not serve anything (yet).",
};

const ERROR_PREFIXES = ["MCP_", "PAYMENT_", "SETTLEMENT_", "PROVIDER_", "TOOL_"];

/**
 * An API error code as one sentence. Unknown codes get a safe generic
 * sentence; pass the HTTP status (`ApiError.status`) and an unknown 5xx says
 * it is Assay's side, instead of "Something went wrong". It does not claim
 * nothing changed: a 5xx does not prove that.
 */
export function plainError(code: string | null | undefined, status?: number): string {
  if (code && ERRORS[code]) return ERRORS[code]!;
  for (const prefix of ERROR_PREFIXES) {
    if (code?.startsWith(prefix) && ERRORS[code.slice(prefix.length)]) return ERRORS[code.slice(prefix.length)]!;
  }
  if (status !== undefined && status >= 500) return serverErrorSentence(status);
  if (!code) return "Something went wrong. Try again.";
  return "Something went wrong. Try again, and if it keeps happening, contact support.";
}

/**
 * `plainError` for an error object. A 429 carries the wait the server named
 * (`retryAfterSeconds`), so the sentence says it; every other code is
 * `plainError(code, status)`.
 */
export function plainApiError(error: {
  code?: string | null;
  status?: number;
  retryAfterSeconds?: number | null;
  message?: string;
}): string {
  if (error.code === "TOO_MANY_REQUESTS") return tooManyRequestsSentence(error.retryAfterSeconds);
  if (error.code === "ACCOUNT_BLOCKED" && namesOwnAccount(error.message)) return OWN_ACCOUNT_BLOCKED;
  return plainError(error.code, error.status);
}

const OWN_ACCOUNT_BLOCKED = "Your account is blocked by Assay. Contact support.";

/**
 * `ACCOUNT_BLOCKED` names either this account ("Your account is blocked by
 * Assay…", BUG-X-02) or another party of the request ("This account is blocked
 * (payee)…"); only the first may say "your".
 */
export function namesOwnAccount(message: string | null | undefined): boolean {
  return typeof message === "string" && /^your account is blocked\b/i.test(message.trim());
}

/** An unknown 5xx: Assay's side, and what to do. */
function serverErrorSentence(status: number): string {
  if (status === 503 || status === 502 || status === 504) {
    return `This part of Assay is unavailable right now (HTTP ${status}). Try again in a few minutes; if it keeps happening, tell Assay support.`;
  }
  return `Something failed on Assay's side (HTTP ${status}). Try again; if it keeps happening, tell Assay support.`;
}

/** Whether the dictionary has a sentence of its own for this code. */
export function knowsError(code: string): boolean {
  return Boolean(ERRORS[code] || ERROR_PREFIXES.some((p) => code.startsWith(p) && ERRORS[code.slice(p.length)]));
}

/* ------------------------------------------------------------------------
 * Audit actions and events
 * ---------------------------------------------------------------------- */

const AUDIT_ACTIONS: Record<string, string> = {
  "credential.created": "Agent key created",
  "credential.revoked": "Agent key revoked",
  "agent.renamed": "Agent renamed",
  "limit.updated": "Spending limits changed",
  "spend_policy.created": "Spending limits set",
  "spend_policy.updated": "Spending limits changed",
  "notification_channel.created": "Alert channel added",
  "notification_channel.updated": "Alert channel changed",
  "notification_preference.updated": "Alert settings changed",
  "payout_address.updated": "Payout address changed",
  "signer.authorized": "Agent allowed to pay",
  "slash_proposal.suspended": "Pending penalty suspended",
  "slash_proposal.attestation_cancelled": "Penalty cancelled during the waiting period",
  "dispute.decided": "Dispute decided",
  "slash.reversed": "Penalty reversed",
  "dispute.countersigned": "Second reviewer signed",
  "dispute.deadline_extended": "Dispute deadline extended",
  "fleet_sweep.opened": "Review across providers opened",
  "slash.arbiter_ruling_prepared": "Arbiter ruling prepared",
  "penalty.waived_de_minimis": "Small penalty waived",
  "sla_window.agent_calls_excluded": "An agent's calls excluded from a window",
  "slash.agent_excluded_from_distribution": "Agent excluded from compensation",
  "provider.tier_adjusted": "Provider tier changed",
  "agent.griefing_score_set": "Agent marked as abusive",
  "sla_window.strikes_removed": "Strikes removed from a window",
  "binding.sampling_forced_full": "Every call now checked",
  "call.reclassified": "Call class corrected",
  "calls.bulk_reclassified": "Call classes corrected",
  "call.retro_verified": "Call checked after the fact",
  "verdict.overridden": "Check result changed by an operator",
  "provider.verified": "Provider verification changed",
  "policy.killed": "Checks switched to observe-only",
  "binding.paused_by_operator": "Listing paused by Assay",
  "provider.suspended": "Provider suspended",
  "account.blocked": "Account blocked",
  "account.unblocked": "Account unblocked",
  "account.unblock": "Unblock account",
  "account.chain_block_prepared": "On-chain block prepared",
  "operator.added": "Operator added",
  "operator.changed": "Operator changed",
  "operator.removed": "Operator removed",
  "operator.add": "Add operator",
  "operator.change": "Change operator",
  "operator.remove": "Remove operator",
  "slash.compensated": "Compensation paid",
  "slash.chain_cancel_closed": "Requested cancel closed (nothing on chain)",
  "slash.execution_recorded": "On-chain execution recorded",
  "slash.reproposed": "Penalty proposed again",
};

/** An audit-log `action` as a short past-tense phrase. */
export function plainAuditAction(action: string): string {
  return AUDIT_ACTIONS[action] ?? humanize(action);
}

/** A notification event key (`balance.low`) as its title. */
export function plainEvent(event: string): string {
  return (NOTIFICATION_EVENT_LABEL as Record<string, string>)[event] ?? AUDIT_ACTIONS[event] ?? humanize(event);
}

/* ------------------------------------------------------------------------
 * One door
 * ---------------------------------------------------------------------- */

/**
 * Any key, from any of the dictionaries above, with the humanised fallback.
 * Prefer the specific function when you know the kind (they read better and
 * take parameters); this is for a column whose key could be anything.
 */
export function plain(key: string | null | undefined): string {
  if (!key) return "";
  if (/^w_\d+$/i.test(key)) return windowLabel(key);
  if (/^quorum_/i.test(key)) return plainDecision(key);
  return (
    RULE_CODES[key] ??
    TERMS[key] ??
    OUTCOMES[key] ??
    RESPONSE_CLASSES[key] ??
    CLASSIFICATION_REASONS[key] ??
    STATUSES[key] ??
    INELIGIBILITY[key] ??
    DECISIONS[key] ??
    AUDIT_ACTIONS[key] ??
    (NOTIFICATION_EVENT_LABEL as Record<string, string>)[key] ??
    (knowsError(key) ? plainError(key).replace(/\.$/, "") : null) ??
    (isRuleType(key) ? plainRule(key) : null) ??
    humanize(key)
  );
}

const RULE_TYPES = new Set(["MIN_ARRAY_LENGTH", "REQUIRED_FIELDS", "FRESHNESS", "VALUE_RANGE", "VALID_URL", "NO_DUPLICATES"]);
function isRuleType(key: string): boolean {
  return RULE_TYPES.has(key);
}

export const plainRuleCode = (code: string): string => RULE_CODES[code] ?? humanize(code);
export const plainStatus = (key: string): string => STATUSES[key] ?? humanize(key);
