import type { Money } from "@/interfaces/api";
import type {
  AccountBlock,
  OperatorApproval,
  OperatorDirectoryEntry,
  OperatorIdentity,
  OperatorRole,
} from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import { shortAddress } from "@/libs/chains/format";
import { formatMoney } from "@/utils/money";

import { ROLE_OPTIONS } from "./directory";

/**
 * The approvals inbox's rules, kept out of the page so they can be tested.
 *
 * Mirrors `docs/runbooks/operator-access.md` §4 in assay-backend: which roles
 * may approve each register row, who may reject, and what each refusal means.
 */

/** What each queued action does, in plain words. */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  "slash.suspend": "Suspend a slash proposal (cancels the penalty)",
  "slash.sweep": "Open a fleet sweep across every case with the same defect",
  "slash.compensated": "Record a treasury compensation and close the case as compensated",
  "account.unblock": "Lift an account block",
  "operator.add": "Add an operator",
  "operator.change": "Raise an operator's roles or authority limit",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** The roles a second person must hold, per register code. At least one. */
export const APPROVER_ROLES: Readonly<Record<string, readonly OperatorRole[]>> = {
  "S-1": ["ADJ", "ADJL"],
  "S-11": ["ADJ", "ADJL"],
  "S-5": ["ADJL", "TRE"],
  "A-10": ["ADJL"],
  "A-12": ["OPS_ADMIN"],
  "A-13": ["OPS_ADMIN"],
};

export function approverRolesFor(code: string): readonly OperatorRole[] | null {
  return APPROVER_ROLES[code] ?? null;
}

function holdsApproverRole(code: string, roles: readonly OperatorRole[]): boolean {
  const required = approverRolesFor(code);
  // A code this build does not know: the backend decides.
  if (!required) return true;
  return roles.some((role) => required.includes(role));
}

export function isOwnRequest(approval: OperatorApproval, me: Pick<OperatorIdentity, "id">): boolean {
  return approval.requestedById === me.id;
}

/**
 * Approve is never shown on your own request: the backend refuses it with
 * `OPERATOR_SELF_APPROVAL_REFUSED`, and the inbox should not offer it.
 */
export function showApprove(approval: OperatorApproval, me: Pick<OperatorIdentity, "id">): boolean {
  return approval.status === "PENDING" && !isOwnRequest(approval, me);
}

/** Shown but held back, with this reason, when the roles do not cover the code. */
export function approveBlockedBecause(
  approval: OperatorApproval,
  me: Pick<OperatorIdentity, "roles">,
): string | null {
  if (holdsApproverRole(approval.code, me.roles)) return null;
  const required = approverRolesFor(approval.code) ?? [];
  return `Approving ${approval.code} needs ${required.join(" or ")}.`;
}

/**
 * Reject is the requester's way to withdraw, and otherwise needs a role that
 * could have approved it.
 */
export type RejectMode = "withdraw" | "reject" | null;

export function rejectMode(
  approval: OperatorApproval,
  me: Pick<OperatorIdentity, "id" | "roles">,
): RejectMode {
  if (approval.status !== "PENDING") return null;
  if (isOwnRequest(approval, me)) return "withdraw";
  return holdsApproverRole(approval.code, me.roles) ? "reject" : null;
}

// ── What an approval is about, in words ─────────────────────────────────────

/**
 * What the inbox already knows besides the approval itself: the rows of
 * `GET /operator/blocks` and `GET /operator/operators`, keyed by id. Either may
 * be empty (not loaded yet, or the row is past the first page); every label
 * then falls back to the id, shortened.
 */
export interface ApprovalContext {
  readonly blocks: ReadonlyMap<string, Pick<AccountBlock, "subjectKind" | "subject" | "active" | "reasonCode" | "blockedBy">>;
  readonly operators: ReadonlyMap<
    string,
    Pick<OperatorDirectoryEntry, "subject" | "displayName" | "walletAddress" | "roles" | "authorityLimit">
  >;
  /** The platform asset, read off any directory row, to turn minor units into money. */
  readonly asset: Pick<Money, "asset" | "decimals"> | null;
}

export const EMPTY_APPROVAL_CONTEXT: ApprovalContext = {
  blocks: new Map(),
  operators: new Map(),
  asset: null,
};

export interface ApprovalDescription {
  /** One sentence: what approving runs. */
  readonly sentence: string;
  readonly target: { readonly label: string; readonly href: string | null };
  /** Labelled fields, in reading order. */
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}

const ROLE_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  ROLE_OPTIONS.map((option) => [option.role, option.label]),
);

/** `7b2acf05-2b3e-…` → `7b2acf05…`. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function rolesOf(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map(String) : null;
}

function rolesText(roles: readonly string[]): string {
  return roles.length === 0 ? "none" : roles.join(", ");
}

function rolesLong(roles: readonly string[]): string {
  return roles.length === 0
    ? "none"
    : roles.map((role) => (ROLE_LABEL[role] ? `${role} (${ROLE_LABEL[role]})` : role)).join(", ");
}

/** `0x07cd29…` → `0x07cd…4D711` checksummed; anything else unchanged. */
function shortEvm(address: string): string {
  return shortAddress("eip155:1", toChecksumAddress(address));
}

/** Minor units off the wire → money, `unbounded`, or the bare count when the asset is unknown. */
export function limitText(minor: unknown, asset: ApprovalContext["asset"]): string | null {
  if (minor === null) return "unbounded";
  const amount = text(minor);
  if (amount === null || !/^[0-9]+$/.test(amount)) return null;
  if (asset) return formatMoney({ amount, asset: asset.asset, decimals: asset.decimals });
  return amount === "0" ? "$0.00" : `${amount} minor units`;
}

/** A block's subject in words: `wallet 0x0000…0abc` or `organization 1b2c3d4e…`. */
function blockSubject(block: Pick<AccountBlock, "subjectKind" | "subject">): string {
  if (block.subjectKind === "ORGANIZATION") return `organization ${block.subject}`;
  const parts = block.subject.split(":");
  const address = parts.length >= 3 ? parts.slice(2).join(":") : block.subject;
  const chain = parts.length >= 3 ? `${parts[0]}:${parts[1]}` : "eip155:1";
  return `wallet ${shortAddress(chain, chain.startsWith("eip155") ? toChecksumAddress(address) : address)}`;
}

function operatorName(
  operator: Pick<OperatorDirectoryEntry, "subject" | "displayName"> | undefined,
  id: string,
): string {
  if (!operator) return `operator ${shortId(id)}`;
  return operator.displayName && operator.displayName !== operator.subject
    ? `${operator.displayName} (${operator.subject})`
    : operator.subject;
}

/** The fields every request carries, last. */
function commonFields(body: Record<string, unknown>): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  const reason = text(body.reasonCode);
  if (reason) fields.push({ label: "Reason code", value: reason });
  const ticket = text(body.ticketRef);
  if (ticket) fields.push({ label: "Ticket", value: ticket });
  const note = text(body.note);
  if (note) fields.push({ label: "Note", value: note });
  return fields;
}

const KNOWN_KEYS = new Set([
  "reasonCode", "ticketRef", "note", "roles", "authorityLimitMinor", "walletAddress", "subject",
  "displayName", "defectKey", "lookbackHours", "signature",
]);

/** `lookbackHours` → `Lookback hours`. For a field this build does not know. */
function humanKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function extraFields(body: Record<string, unknown>): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(body)) {
    if (KNOWN_KEYS.has(key)) continue;
    const value =
      raw === null ? "none" : Array.isArray(raw) ? raw.map(String).join(", ") : typeof raw === "object" ? JSON.stringify(raw) : text(raw);
    if (value) fields.push({ label: humanKey(key), value: value.length > 160 ? `${value.slice(0, 157)}…` : value });
  }
  return fields;
}

function caseTarget(id: string) {
  return { label: `Case ${shortId(id)}`, href: `/operator/cases/${encodeURIComponent(id)}` };
}

/**
 * An approval in plain words: the sentence an approver reads, the target
 * resolved to what it names, and the request's fields with labels.
 *
 * BUG-R15-OP-01: the card showed `authorityLimitMinor 0` and "Block 7b2acf05-…",
 * so an approver could not tell which account a lift was for.
 */
export function describeApproval(
  approval: Pick<OperatorApproval, "action" | "target" | "payload">,
  context: ApprovalContext = EMPTY_APPROVAL_CONTEXT,
): ApprovalDescription {
  const payload = approval.payload ?? {};
  const body =
    payload.body && typeof payload.body === "object" && !Array.isArray(payload.body)
      ? (payload.body as Record<string, unknown>)
      : payload;
  const colon = approval.target.indexOf(":");
  const targetId = colon === -1 ? "" : approval.target.slice(colon + 1);
  const reason = text(body.reasonCode);
  const because = reason ? ` (reason ${reason})` : "";

  switch (approval.action) {
    case "account.unblock": {
      const blockId = text(payload.blockId) ?? targetId;
      const block = context.blocks.get(blockId);
      const who = block ? blockSubject(block) : `block ${shortId(blockId)}`;
      const fields: { label: string; value: string }[] = [];
      if (block) {
        fields.push({ label: "Blocked", value: `${block.subject} · by ${block.blockedBy} · ${block.reasonCode}` });
        if (!block.active) fields.push({ label: "Block now", value: "already lifted" });
      }
      return {
        sentence: `Lift the block on ${who}${because}.`,
        target: { label: who.charAt(0).toUpperCase() + who.slice(1), href: "/operator/blocks" },
        fields: [...fields, ...commonFields(body), ...extraFields(body)],
      };
    }

    case "operator.add": {
      const wallet = text(body.walletAddress) ?? targetId;
      const subject = text(body.subject) ?? "a new operator";
      const name = text(body.displayName);
      const roles = rolesOf(body.roles) ?? [];
      const limit = limitText(body.authorityLimitMinor === undefined ? "0" : body.authorityLimitMinor, context.asset);
      const fields = [
        { label: "Operator", value: name && name !== subject ? `${name} (${subject})` : subject },
        { label: "Wallet", value: toChecksumAddress(wallet) },
        { label: "Roles", value: rolesLong(roles) },
        ...(limit ? [{ label: "Authority limit", value: limit }] : []),
      ];
      return {
        sentence: `Add operator ${subject} with wallet ${shortEvm(wallet)}, roles ${rolesText(roles)}${limit ? `, limit ${limit}` : ""}${because}.`,
        target: { label: `Wallet ${toChecksumAddress(wallet)}`, href: "/operator/operators" },
        fields: [...fields, ...commonFields(body), ...extraFields(body)],
      };
    }

    case "operator.change": {
      const operatorId = text(payload.operatorId) ?? targetId;
      const operator = context.operators.get(operatorId);
      const who = operatorName(operator, operatorId);
      const roles = rolesOf(body.roles);
      const hasLimit = Object.prototype.hasOwnProperty.call(body, "authorityLimitMinor");
      const limit = hasLimit ? limitText(body.authorityLimitMinor, context.asset) : null;
      const sentence =
        roles && limit
          ? `Raise the roles of ${who} to ${rolesText(roles)} and the authority limit to ${limit}`
          : roles
            ? `Raise the roles of ${who} to ${rolesText(roles)}`
            : limit
              ? `Raise the authority limit of ${who} to ${limit}`
              : `Change the access of ${who}`;
      const fields: { label: string; value: string }[] = [];
      if (operator?.walletAddress) fields.push({ label: "Wallet", value: toChecksumAddress(operator.walletAddress) });
      if (operator) fields.push({ label: "Roles now", value: rolesText(operator.roles) });
      if (roles) fields.push({ label: "New roles", value: rolesLong(roles) });
      if (operator && hasLimit) {
        fields.push({
          label: "Limit now",
          value: operator.authorityLimit === null ? "unbounded" : formatMoney(operator.authorityLimit),
        });
      }
      if (limit) fields.push({ label: "New limit", value: limit });
      return {
        sentence: `${sentence}${because}.`,
        target: { label: operator ? `Operator ${operator.subject}` : `Operator ${shortId(operatorId)}`, href: "/operator/operators" },
        fields: [...fields, ...commonFields(body), ...extraFields(body)],
      };
    }

    case "slash.suspend": {
      const id = text(payload.proposalId) ?? targetId;
      return {
        sentence: `Suspend case ${shortId(id)}, which cancels its penalty${because}.`,
        target: caseTarget(id),
        fields: [...commonFields(body), ...extraFields(body)],
      };
    }

    case "slash.sweep": {
      const id = text(payload.proposalId) ?? targetId;
      const defect = text(body.defectKey);
      const hours = text(body.lookbackHours);
      const fields: { label: string; value: string }[] = [];
      if (defect) fields.push({ label: "Defect", value: defect });
      if (hours) fields.push({ label: "Look back", value: `${hours} h` });
      return {
        sentence: `Sweep every case with defect ${defect ?? "?"} over the last ${hours ?? "?"} h, decided like case ${shortId(id)}${because}.`,
        target: caseTarget(id),
        fields: [...fields, ...commonFields(body), ...extraFields(body)],
      };
    }

    case "slash.compensated": {
      const id = text(payload.proposalId) ?? targetId;
      const signature = text(body.signature);
      return {
        sentence: `Record compensation for case ${shortId(id)} and close it as compensated${because}.`,
        target: caseTarget(id),
        fields: [
          ...(signature ? [{ label: "Deposit signature", value: signature }] : []),
          ...commonFields(body),
          ...extraFields(body),
        ],
      };
    }

    default:
      return {
        sentence: `${actionLabel(approval.action)}.`,
        target: { label: approval.target, href: null },
        fields: [...commonFields(body), ...extraFields(body)],
      };
  }
}

/** One sentence for what an approval did, from the action's own result. */
export function approvedResultSentence(action: string, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  switch (action) {
    case "slash.sweep":
      return `Fleet sweep opened: ${String(r.matchedCount ?? "?")} matched, ${String(r.appliedCount ?? "?")} applied.`;
    case "slash.suspend":
      return "Proposal suspended. If a record stands on chain, its cancel is requested and still needs its signer.";
    case "slash.compensated":
      return "Deposit verified on chain. The case is recorded as compensated.";
    case "account.unblock":
      return `Block lifted${typeof r.subject === "string" ? ` on ${r.subject}` : ""}.`;
    case "operator.add":
      return `Operator added${typeof r.subject === "string" ? `: ${r.subject}` : ""}. They can sign in with their wallet now.`;
    case "operator.change":
      return `Operator changed${typeof r.subject === "string" ? `: ${r.subject}` : ""}.`;
    default:
      return "Approved. The action ran.";
  }
}

/**
 * An approve or reject refusal in words. The approval stays `PENDING` after
 * any failed approve, so the sentence says what can be done next.
 */
export function approvalErrorMessage(error: unknown, kind: "approve" | "reject" | "list"): string {
  if (!(error instanceof ApiError)) {
    return kind === "list" ? "The approvals could not be loaded." : "The request could not be completed.";
  }
  const tail = ` (${error.code})`;
  switch (error.code) {
    case "OPERATOR_SELF_APPROVAL_REFUSED":
      return `You asked for this action, so you cannot approve it. A different operator must.${tail}`;
    case "OPERATOR_APPROVER_ROLE_REQUIRED":
      return `Your roles do not cover this action, so you cannot ${kind === "reject" ? "reject" : "approve"} it.${tail}`;
    case "OPERATOR_APPROVER_AUTHORITY_EXCEEDED":
      return `The amount is above your authority limit. An operator with a higher limit must approve it.${tail}`;
    case "OPERATOR_APPROVAL_NOT_PENDING":
      return `This request was already approved, rejected or has expired. The list has been refreshed.${tail}`;
    case "OPERATOR_APPROVAL_NOT_FOUND":
      return `There is no such approval.${tail}`;
    case "OPERATOR_NOT_AUTHORIZED":
      return `The operator who asked is no longer active, so the action cannot run. Reject it.${tail}`;
    case "OPERATOR_SELF_CHANGE_REFUSED":
      return `This change is about your own access, and nobody may approve a change to their own row.${tail}`;
    case "NETWORK_ERROR":
      return `The API could not be reached. Check the list before you try again.${tail}`;
    default:
      if (kind === "approve") {
        return `The action was re-checked against the current state and refused: ${error.message}.${tail} It is still pending: retry once the cause is fixed, reject it, or let it expire.`;
      }
      return `${error.message}${tail}`;
  }
}

/** The pending badge: a count, `100+` past one page. */
export function pendingBadge(count: number, hasMore: boolean): string | null {
  if (count <= 0) return null;
  return hasMore ? `${count}+` : String(count);
}
