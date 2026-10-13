/**
 * @fileoverview
 * The account blocklist screen's rules, as pure functions: who may act, what a
 * valid form is, and what each refusal means in words.
 *
 * Mirrors assay-backend `CreateAccountBlockBodyDto` / `UnblockAccountBodyDto`
 * (`src/modules/operator/dto/operator-console.dto.ts`), `normalizeSubject`
 * (`src/modules/blocklist/domain/account-block.ts`) and the `OPERATOR_*`
 * catalogue (`src/modules/operator/errors/operator.errors.ts`). The server
 * checks all of it again; this is so an operator learns what is wrong next to
 * the field, before a refusal.
 */
import type {
  BlockSubjectKind,
  CreateAccountBlockBody,
  OperatorRole,
  UnblockAccountBody,
} from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

/** `A-9` and `A-10` are open to these roles (the maker). */
export const BLOCK_ROLES: readonly OperatorRole[] = Object.freeze(["ADJL", "SRE"]);
/** The second operator of an `A-10` must hold this. */
export const UNBLOCK_APPROVER_ROLES: readonly OperatorRole[] = Object.freeze(["ADJL"]);

export const BLOCK_NOTE_MIN = 20;
export const BLOCK_NOTE_MAX = 4096;
export const REASON_CODE_MAX = 64;
export const TICKET_REF_MAX = 128;
export const SUBJECT_MAX = 256;

/** Suggestions only: the backend takes any reason code up to 64 characters. */
export const BLOCK_REASON_SUGGESTIONS: readonly string[] = Object.freeze([
  "LEAKED_KEY", "FRAUD", "LEGAL_HOLD",
]);
export const UNBLOCK_REASON_SUGGESTIONS: readonly string[] = Object.freeze([
  "KEY_ROTATED", "RESOLVED", "BLOCKED_IN_ERROR",
]);

/**
 * The chain a bare `0x` address is sent on. Any EVM chain would do: a wallet
 * block is matched on `eip155:<address>` with no chain reference, so it covers
 * every EVM chain whichever one is named.
 */
export const BARE_EVM_ADDRESS_CHAIN = "eip155:1";

export function mayBlock(roles: readonly OperatorRole[]): boolean {
  return roles.some((role) => BLOCK_ROLES.includes(role));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** CAIP-10, the backend's grammar: namespace 3–8, reference 1–32, address 1–128. */
const CAIP10_RE = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32}):([-.%a-zA-Z0-9]{1,128})$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type SubjectResult =
  | { readonly ok: true; readonly subject: string; readonly note?: string }
  | { readonly ok: false; readonly error: string };

/**
 * The subject as it will be sent, or why it cannot be.
 *
 * An organization is its uuid, lower-cased. A wallet is a CAIP-10 account; an
 * `eip155` one must carry a real `0x` + 40 hex address and is lower-cased (the
 * backend matches EVM case-insensitively). A bare `0x` address is accepted and
 * sent on {@link BARE_EVM_ADDRESS_CHAIN}.
 */
export function normaliseSubject(kind: BlockSubjectKind, raw: string): SubjectResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: kind === "ORGANIZATION" ? "Enter the organization id." : "Enter the wallet." };
  }
  if (value.length > SUBJECT_MAX) {
    return { ok: false, error: `At most ${SUBJECT_MAX} characters.` };
  }
  if (kind === "ORGANIZATION") {
    return UUID_RE.test(value)
      ? { ok: true, subject: value.toLowerCase() }
      : { ok: false, error: "An organization is blocked by its id, a uuid such as 3f2c…-…-…-…-…." };
  }
  if (EVM_ADDRESS_RE.test(value)) {
    const subject = `${BARE_EVM_ADDRESS_CHAIN}:${value.toLowerCase()}`;
    return {
      ok: true,
      subject,
      note: `Sent as ${subject}. The block covers this address on every EVM chain.`,
    };
  }
  const match = CAIP10_RE.exec(value);
  if (!match) {
    return {
      ok: false,
      error: "Not a wallet. Use a CAIP-10 account (eip155:8453:0x…) or a 0x address of 40 hex characters.",
    };
  }
  const [, namespace, reference, address] = match;
  if (namespace === "eip155") {
    if (!/^\d+$/.test(reference)) {
      return { ok: false, error: "An eip155 chain reference is a number, e.g. eip155:8453:0x…." };
    }
    if (!EVM_ADDRESS_RE.test(address)) {
      return { ok: false, error: "An EVM address is 0x followed by 40 hex characters." };
    }
    return { ok: true, subject: value.toLowerCase() };
  }
  // Solana and other namespaces are case-sensitive: kept as written.
  return { ok: true, subject: value };
}

export interface BlockFormInput {
  subjectKind: BlockSubjectKind;
  subject: string;
  reasonCode: string;
  note: string;
  ticketRef: string;
}

export interface UnblockFormInput {
  reasonCode: string;
  note: string;
  ticketRef: string;
  approverToken: string;
}

export type FormErrors<K extends string> = Partial<Record<K, string>>;

export type Validated<B, K extends string> =
  | { readonly ok: true; readonly body: B }
  | { readonly ok: false; readonly errors: FormErrors<K> };

function reasonCodeError(value: string): string | undefined {
  if (value.length === 0) return "Choose or type a reason code.";
  if (value.length > REASON_CODE_MAX) return `At most ${REASON_CODE_MAX} characters.`;
  return undefined;
}

function noteError(value: string): string | undefined {
  if (value.length < BLOCK_NOTE_MIN) {
    return `At least ${BLOCK_NOTE_MIN} characters (${value.length} so far): what happened and who reported it.`;
  }
  if (value.length > BLOCK_NOTE_MAX) return `At most ${BLOCK_NOTE_MAX} characters.`;
  return undefined;
}

function ticketError(value: string): string | undefined {
  return value.length > TICKET_REF_MAX ? `At most ${TICKET_REF_MAX} characters.` : undefined;
}

/** Strips undefined entries, so `ok` is decided on what is actually wrong. */
function compact<K extends string>(errors: FormErrors<K>): FormErrors<K> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v !== undefined)) as FormErrors<K>;
}

export function validateBlockForm(
  input: BlockFormInput,
): Validated<CreateAccountBlockBody, keyof BlockFormInput> {
  const subject = normaliseSubject(input.subjectKind, input.subject);
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const ticketRef = input.ticketRef.trim();

  const errors = compact<keyof BlockFormInput>({
    subject: subject.ok ? undefined : subject.error,
    reasonCode: reasonCodeError(reasonCode),
    note: noteError(note),
    ticketRef: ticketError(ticketRef),
  });
  if (!subject.ok || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    body: {
      subjectKind: input.subjectKind,
      subject: subject.subject,
      reasonCode,
      note,
      ...(ticketRef ? { ticketRef } : {}),
    },
  };
}

export function validateUnblockForm(
  input: UnblockFormInput,
): Validated<UnblockAccountBody & { approverToken: string }, keyof UnblockFormInput> {
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const ticketRef = input.ticketRef.trim();
  const approverToken = input.approverToken.trim();

  const errors = compact<keyof UnblockFormInput>({
    reasonCode: reasonCodeError(reasonCode),
    note: noteError(note),
    ticketRef: ticketError(ticketRef),
    approverToken:
      approverToken.length === 0
        ? "Lifting a block takes a second operator: paste their own operator token."
        : undefined,
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    body: { reasonCode, note, ...(ticketRef ? { ticketRef } : {}), approverToken },
  };
}

export type BlockAction = "list" | "block" | "unblock";

/**
 * Every refusal these three routes can answer, in words an operator can act
 * on. The code is always kept next to the sentence so it can be quoted into a
 * ticket. A code not listed here falls back to the backend's own message.
 */
const MESSAGES: Readonly<Record<string, string | ((action: BlockAction, e: ApiError) => string)>> = {
  OPERATOR_BLOCK_SUBJECT_INVALID: (action) =>
    action === "list"
      ? "The subject filter is not an organization id or a CAIP-10 account."
      : "The subject is not valid: an organization takes its uuid, a wallet a CAIP-10 account.",
  OPERATOR_BLOCK_NOT_FOUND: "That block no longer exists. Reload the list.",
  OPERATOR_BLOCK_ALREADY_ACTIVE: (_action, e) =>
    `This subject is already blocked; there is one standing block per subject. ${e.message}.`,
  OPERATOR_BLOCK_ALREADY_LIFTED: "This block has already been lifted. Reload the list to see who lifted it.",
  OPERATOR_SECOND_APPROVER_REQUIRED:
    "Lifting a block needs a second operator. Paste the approver's own operator token.",
  OPERATOR_SELF_APPROVAL_REFUSED:
    "The approver token is your own. A second, different operator must approve.",
  OPERATOR_APPROVER_ROLE_REQUIRED:
    "The approver does not hold ADJL. Only an ADJL operator can approve lifting a block.",
  OPERATOR_APPROVER_AUTHORITY_EXCEEDED: "The approver's authority does not cover this action.",
  OPERATOR_ROLE_REQUIRED: (action) =>
    action === "unblock"
      ? "Lifting a block needs the ADJL or SRE role, and you hold neither."
      : "Blocking needs the ADJL or SRE role, and you hold neither.",
  OPERATOR_AUTHORITY_EXCEEDED: "This action is above your authority.",
  OPERATOR_CREDENTIAL_INVALID: (action) =>
    action === "unblock"
      ? "An operator token was refused: either the approver's token is wrong or expired, or your own session has ended. Check the approver's token, or sign in again."
      : "Your operator token was refused. Sign out and sign in again.",
  OPERATOR_SUSPENDED: (action) =>
    action === "unblock"
      ? "An operator in this action is suspended, you or the approver. A suspended operator cannot act or approve."
      : "Your operator account is suspended.",
  OPERATOR_AUTH_RATE_LIMITED: "Too many attempts with operator tokens. Wait a minute and try again.",
  OPERATOR_OVERRIDE_NOT_IMPLEMENTED: "The backend does not have this action switched on yet.",
  OPERATOR_UNKNOWN_OVERRIDE_CODE: "The backend does not know this override. Report it to engineering.",
  VALIDATION_FAILED: (_action, e) => `The request was not accepted: ${e.message}.`,
  BAD_REQUEST: (_action, e) => `The request was not accepted: ${e.message}.`,
  NETWORK_ERROR: "The API could not be reached. Check your connection and try again.",
  ECONNABORTED: "The API took too long to answer. Check the list before you try again.",
};

export function blockErrorMessage(error: unknown, action: BlockAction): string {
  if (!(error instanceof ApiError)) {
    return action === "list"
      ? "The blocks could not be loaded."
      : "The action could not be completed. Check the list before you try again.";
  }
  const entry = MESSAGES[error.code];
  const sentence =
    typeof entry === "function" ? entry(action, error) : (entry ?? error.message);
  return `${sentence} (${error.code})`;
}
