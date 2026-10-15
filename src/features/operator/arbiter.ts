/**
 * @fileoverview
 * The arbiter page's rules, as pure functions: who may prepare what, what the
 * selection may hold, what a valid form is, and what each refusal means.
 *
 * Mirrors assay-backend `OperatorArbiterController`
 * (`src/modules/operator/controllers/operator-arbiter.controller.ts`):
 * `S-13` ruling (`ADJL`, `TRE`) and `A-11` on-chain block (`ADJL`, `SRE`,
 * `TRE`), both single-operator, both with a reason code, a note of at least
 * 20 characters and an optional ticket (`ArbiterRulingBodyDto`,
 * `ArbiterBlockBodyDto`). The server checks all of it again.
 *
 * Both routes only BUILD. The arbiter's own wallet signs; nothing changes on
 * chain, or in a case, until that transaction lands.
 */
import type {
  ArbiterBlockBody,
  ArbiterDispute,
  ArbiterRuling,
  ArbiterRulingBody,
  ArbiterSupersededCancelBody,
  ArbiterSupersededRecord,
  OperatorRole,
} from "@/interfaces/operator";
import { refusedFunctionOf } from "@/features/chain-calls/refusals";
import { ApiError } from "@/libs/ApiClient";
import { MAX_SLASH_BATCH } from "@/libs/chains/evm/stake-slashes/abi";
import { normaliseEvmAddress } from "@/libs/chains/evm/stake-slashes/address";
import { describeChainRefusal } from "@/libs/chains/status-labels";

import { BLOCK_NOTE_MAX, BLOCK_NOTE_MIN, REASON_CODE_MAX, TICKET_REF_MAX } from "./blocks";

export const ARBITER_RULING_ROLES: readonly OperatorRole[] = Object.freeze(["ADJL", "TRE"]);
export const ARBITER_BLOCK_ROLES: readonly OperatorRole[] = Object.freeze(["ADJL", "SRE", "TRE"]);

export const ARBITER_SELECTION_MAX = MAX_SLASH_BATCH;
export const ARBITER_NOTE_MIN = BLOCK_NOTE_MIN;

export function mayRule(roles: readonly OperatorRole[]): boolean {
  return roles.some((role) => ARBITER_RULING_ROLES.includes(role));
}

export function mayBlockOnChain(roles: readonly OperatorRole[]): boolean {
  return roles.some((role) => ARBITER_BLOCK_ROLES.includes(role));
}

/** Suggestions only: the backend takes any reason code up to 64 characters. */
export const RULING_REASON_SUGGESTIONS: Readonly<Record<ArbiterRuling, readonly string[]>> = Object.freeze({
  UPHOLD: ["EVIDENCE_HOLDS", "PROVIDER_CONFIRMED", "RATE_GENUINELY_EXCEEDED"],
  CANCEL: ["OVERTURNED", "PLATFORM_DEFECT", "INSUFFICIENT_EVIDENCE"],
});
export const CHAIN_BLOCK_REASON_SUGGESTIONS: readonly string[] = Object.freeze([
  "LEAKED_KEY", "FRAUD", "LEGAL_HOLD",
]);

export const RULING_LABEL: Readonly<Record<ArbiterRuling, string>> = Object.freeze({
  UPHOLD: "Uphold — rule against the provider (upholdSlashBatch)",
  CANCEL: "Cancel — rule for the provider, release the stake (cancelSlashBatch)",
});

// ── Selection ───────────────────────────────────────────────────────────────

export type ArbiterToggle =
  | { readonly ok: true; readonly selected: ReadonlySet<string> }
  | { readonly ok: false; readonly selected: ReadonlySet<string>; readonly reason: "limit" | "other-chain" };

/** The chain every selected row is on, or `null` for an empty selection. */
export function selectionChain(
  selected: ReadonlySet<string>,
  rows: readonly ArbiterDispute[],
): string | null {
  for (const row of rows) {
    if (selected.has(row.requestId.toLowerCase())) return row.chainId;
  }
  return null;
}

/**
 * Select or unselect one dispute. One batch is one transaction on one chain,
 * so a row on another chain than the ones already selected is refused, and so
 * is a 65th.
 */
export function toggleArbiterSelection(
  selected: ReadonlySet<string>,
  row: ArbiterDispute,
  rows: readonly ArbiterDispute[],
): ArbiterToggle {
  const id = row.requestId.toLowerCase();
  if (selected.has(id)) {
    const next = new Set(selected);
    next.delete(id);
    return { ok: true, selected: next };
  }
  const chain = selectionChain(selected, rows);
  if (chain !== null && chain !== row.chainId) return { ok: false, selected, reason: "other-chain" };
  if (selected.size >= ARBITER_SELECTION_MAX) return { ok: false, selected, reason: "limit" };
  const next = new Set(selected);
  next.add(id);
  return { ok: true, selected: next };
}

/** Drops ids no longer in the list (ruled on, expired), keeping the same set when nothing changed. */
export function pruneArbiterSelection(
  selected: ReadonlySet<string>,
  rows: readonly ArbiterDispute[],
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const ids = new Set(rows.map((row) => row.requestId.toLowerCase()));
  const next = new Set([...selected].filter((id) => ids.has(id)));
  return next.size === selected.size ? selected : next;
}

/** Oldest dispute first, as the backend sends it — re-applied so the order never depends on the wire. */
export function sortDisputesOldestFirst(rows: readonly ArbiterDispute[]): ArbiterDispute[] {
  const at = (row: ArbiterDispute) => (row.disputedAt ? Date.parse(row.disputedAt) : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => at(a) - at(b) || a.requestId.localeCompare(b.requestId));
}

/** `slashAgentBps` in words: `6000` → `60% (6000 bps)`. */
export function agentShareText(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "Not reported";
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}% (${bps} bps)`;
}

export type BeneficiaryCheckStatus = "ok" | "failed" | "unchecked";

/**
 * Follow-up C5, as the arbiter reads it: is the beneficiary of this record a
 * payer of the window's failed calls, and is the record's part within that
 * payer's share of the formula penalty? The backend decides
 * (`beneficiaryEvidence.ok`); this only puts it in words.
 */
export function beneficiaryCheck(row: ArbiterDispute): {
  readonly status: BeneficiaryCheckStatus;
  readonly headline: string;
  readonly reason: string | null;
} {
  const evidence = row.beneficiaryEvidence;
  if (!evidence) {
    return {
      status: "unchecked",
      headline:
        "Not checked: the backend could not match this record to its window's payments, or could not read the chain's agent share. Check the beneficiary by hand.",
      reason: null,
    };
  }
  if (evidence.ok) {
    return {
      status: "ok",
      headline: `The beneficiary paid for ${evidence.failedCalls} failed call${evidence.failedCalls === 1 ? "" : "s"}, and this penalty is within its share of the formula penalty.`,
      reason: null,
    };
  }
  return {
    status: "failed",
    headline:
      "The beneficiary check fails: upholding would pay an account that did not pay for these failed calls, or more than its share of the penalty.",
    reason: evidence.reason,
  };
}

// ── Forms ───────────────────────────────────────────────────────────────────

export type ArbiterFormErrors<K extends string> = Partial<Record<K, string>>;

export type ArbiterValidated<B, K extends string> =
  | { readonly ok: true; readonly body: B }
  | { readonly ok: false; readonly errors: ArbiterFormErrors<K> };

export interface RulingFormInput {
  ruling: ArbiterRuling | "";
  reasonCode: string;
  note: string;
  ticketRef: string;
}

export interface ChainBlockFormInput {
  account: string;
  reasonCode: string;
  note: string;
  ticketRef: string;
}

function reasonCodeError(value: string): string | undefined {
  if (value.length === 0) return "Choose or type a reason code.";
  if (value.length > REASON_CODE_MAX) return `At most ${REASON_CODE_MAX} characters.`;
  return undefined;
}

function noteError(value: string): string | undefined {
  if (value.length < ARBITER_NOTE_MIN) {
    return `At least ${ARBITER_NOTE_MIN} characters (${value.length} so far): why, and on what evidence.`;
  }
  if (value.length > BLOCK_NOTE_MAX) return `At most ${BLOCK_NOTE_MAX} characters.`;
  return undefined;
}

function ticketError(value: string): string | undefined {
  return value.length > TICKET_REF_MAX ? `At most ${TICKET_REF_MAX} characters.` : undefined;
}

function compact<K extends string>(errors: ArbiterFormErrors<K>): ArbiterFormErrors<K> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v !== undefined)) as ArbiterFormErrors<K>;
}

const REQUEST_ID_RE = /^0x[0-9a-f]{64}$/;

export function validateRulingForm(
  input: RulingFormInput,
  chainId: string | null,
  requestIds: readonly string[],
): ArbiterValidated<ArbiterRulingBody, keyof RulingFormInput | "selection"> {
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const ticketRef = input.ticketRef.trim();
  const ids = requestIds.map((id) => id.toLowerCase());

  const errors = compact<keyof RulingFormInput | "selection">({
    selection:
      ids.length === 0 || chainId === null
        ? "Select at least one disputed penalty."
        : ids.length > ARBITER_SELECTION_MAX
          ? `At most ${ARBITER_SELECTION_MAX} in one transaction.`
          : ids.some((id) => !REQUEST_ID_RE.test(id))
            ? "A selected request id is not 0x + 64 hex characters."
            : undefined,
    ruling: input.ruling === "" ? "Choose Uphold or Cancel." : undefined,
    reasonCode: reasonCodeError(reasonCode),
    note: noteError(note),
    ticketRef: ticketError(ticketRef),
  });
  if (Object.keys(errors).length > 0 || input.ruling === "" || chainId === null) return { ok: false, errors };

  return {
    ok: true,
    body: {
      chainId,
      ruling: input.ruling,
      requestIds: ids,
      reasonCode,
      note,
      ...(ticketRef ? { ticketRef } : {}),
    },
  };
}

/** The superseded-record cancel form: the ruling form without a ruling or a selection. */
export interface SupersededCancelFormInput {
  reasonCode: string;
  note: string;
  ticketRef: string;
}

/** The reason code the superseded-record cancel suggests. */
export const SUPERSEDED_REASON_SUGGESTIONS: readonly string[] = Object.freeze([
  "SUPERSEDED_EPOCH",
  "DOUBLE_CHARGE_RISK",
]);

/**
 * Review R2-6: the guarded cancel of ONE superseded record. The body names
 * exactly the row's id and chain; the backend refuses (409) any id that is
 * not a superseded record standing on that chain.
 */
export function validateSupersededCancelForm(
  input: SupersededCancelFormInput,
  record: Pick<ArbiterSupersededRecord, "requestId" | "chainId">,
): ArbiterValidated<ArbiterSupersededCancelBody, keyof SupersededCancelFormInput> {
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const ticketRef = input.ticketRef.trim();
  const errors = compact<keyof SupersededCancelFormInput>({
    reasonCode: reasonCodeError(reasonCode),
    note: noteError(note),
    ticketRef: ticketError(ticketRef),
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      chainId: record.chainId,
      requestId: record.requestId.toLowerCase(),
      reasonCode,
      note,
      ...(ticketRef ? { ticketRef } : {}),
    },
  };
}

export function validateChainBlockForm(
  input: ChainBlockFormInput,
  chainId: string,
): ArbiterValidated<ArbiterBlockBody, keyof ChainBlockFormInput> {
  const account = normaliseEvmAddress(input.account);
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const ticketRef = input.ticketRef.trim();

  const errors = compact<keyof ChainBlockFormInput>({
    account:
      input.account.trim().length === 0
        ? "Enter the address to block."
        : account === null
          ? "An EVM address is 0x followed by 40 hex characters."
          : /^0x0{40}$/i.test(account)
            ? "The zero address cannot be blocked."
            : undefined,
    reasonCode: reasonCodeError(reasonCode),
    note: noteError(note),
    ticketRef: ticketError(ticketRef),
  });
  if (Object.keys(errors).length > 0 || account === null) return { ok: false, errors };

  return {
    ok: true,
    body: { chainId, account, reasonCode, note, ...(ticketRef ? { ticketRef } : {}) },
  };
}

// ── Refusals ────────────────────────────────────────────────────────────────

/** `cancel` is the case page's `cancelSlash` build, which is the arbiter's too. */
export type ArbiterAction = "terms" | "disputes" | "ruling" | "block" | "cancel";

/**
 * Every refusal the four routes can answer, in words. The code is always kept
 * next to the sentence so it can be quoted into a ticket. A code not listed
 * falls back to the backend's own message, led by a chain label when it is a
 * chain refusal.
 */
const MESSAGES: Readonly<Record<string, string | ((action: ArbiterAction, e: ApiError) => string)>> = {
  CHAIN_ARBITER_NOT_SET: (action) =>
    action === "block"
      ? "No arbiter is appointed on this chain, so nobody can block on chain. The admin appoints one with setArbiter."
      : action === "cancel"
        ? "No arbiter is appointed on this chain, so the cancellation cannot be built: Assay builds cancelSlash for the arbiter only. The admin appoints one with setArbiter; build it again then."
        : "No arbiter is appointed on this chain, so nobody can rule on a dispute. The admin appoints one with setArbiter.",
  CHAIN_ADDRESS_ALREADY_BLOCKED: "This address is already blocked on chain. Nothing to do.",
  OPERATOR_APPROVAL_NOT_APPROVED: "This is not an approved on-chain block, so there is no call to sign.",
  CHAIN_PROGRAM_PAUSED: (_a, e) => `Contracts paused — try after unpause. ${e.message}.`,
  CHAIN_ADDRESS_BLOCKED: (_a, e) => `Blocked on chain. ${e.message}.`,
  SLASH_CHAIN_BATCH_REFUSED: (_a, e) =>
    `Nothing was built: the chain would refuse the whole ${refusedFunctionOf(e) ?? "batch"}. The penalties it would refuse are marked in the list; unselect them and try again.`,
  SLASH_CHAIN_UNAVAILABLE: "The backend has no EVM settlement contracts configured, so nothing can be read or built here.",
  CHAIN_UNSUPPORTED: "The backend does not support this chain.",
  CHAIN_PAYLOAD_MALFORMED: (_a, e) => `The request was not accepted: ${e.message}.`,
  OPERATOR_ROLE_REQUIRED: (action) =>
    action === "block"
      ? "Preparing an on-chain block needs ADJL, SRE or TRE, and you hold none of them."
      : "Preparing a ruling needs ADJL or TRE, and you hold neither.",
  OPERATOR_AUTHORITY_EXCEEDED: "This action is above your authority.",
  OPERATOR_CREDENTIAL_INVALID: "Your operator session has ended. Sign in again.",
  OPERATOR_SUSPENDED: "Your operator account is suspended.",
  OPERATOR_AUTH_RATE_LIMITED: "Too many sign-in attempts. Wait a few minutes and try again.",
  OPERATOR_OVERRIDE_NOT_IMPLEMENTED: "The backend does not have this action switched on yet.",
  OPERATOR_UNKNOWN_OVERRIDE_CODE: "The backend does not know this override. Report it to engineering.",
  VALIDATION_FAILED: (_a, e) => `The request was not accepted: ${e.message}.`,
  BAD_REQUEST: (_a, e) => `The request was not accepted: ${e.message}.`,
  NETWORK_ERROR: "The API could not be reached. Check your connection and try again.",
  ECONNABORTED: "The API took too long to answer. Reload before you try again.",
};

export function arbiterErrorMessage(error: unknown, action: ArbiterAction): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) return error.message;
    return action === "terms" || action === "disputes"
      ? "This could not be loaded."
      : "The transaction could not be prepared.";
  }
  const entry = MESSAGES[error.code];
  if (entry === undefined) return describeChainRefusal(error);
  const sentence = typeof entry === "function" ? entry(action, error) : entry;
  return `${sentence} (${error.code})`;
}

/** An approved `A-11` whose unsigned block the arbiter may still have to sign (frontend review N5). */
/**
 * Review R2-7: the approvals query behind the approved-blocks panel. The
 * backend filters by action, so a block is never hidden behind fifty newer
 * approvals of other actions; the backend also refuses (409) a block approved
 * longer ago than the approvals' expiry, or one already carried out and lifted.
 */
export const APPROVED_BLOCKS_QUERY = {
  status: "APPROVED",
  action: "arbiter.block",
  limit: 50,
} as const;

export interface ApprovedArbiterBlock {
  readonly approvalId: string;
  readonly chainId: string;
  readonly account: string;
  readonly approvedBy: string | null;
  readonly decidedAt: string | null;
}

/**
 * The APPROVED `arbiter.block` approvals, newest first as listed, with the
 * address and chain read off the approved payload: the arbiter page offers
 * each one's call again, after the approver's tab is gone.
 */
export function approvedArbiterBlocks(
  approvals: readonly {
    id: string;
    action: string;
    status: string;
    payload: Record<string, unknown>;
    approvedBy: string | null;
    decidedAt: string | null;
  }[],
): ApprovedArbiterBlock[] {
  return approvals.flatMap((approval) => {
    const { chainId, account } = approval.payload;
    if (approval.action !== "arbiter.block" || approval.status !== "APPROVED") return [];
    if (typeof chainId !== "string" || typeof account !== "string") return [];
    return [
      {
        approvalId: approval.id,
        chainId,
        account,
        approvedBy: approval.approvedBy,
        decidedAt: approval.decidedAt,
      },
    ];
  });
}
