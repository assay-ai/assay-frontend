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

import { walletLabel } from "./block-targets";
import { chainDisplayName } from "./call-summary";
import { ROLE_OPTIONS } from "./directory";
import { routes } from "@/libs/routes";

/**
 * The approvals inbox's rules, kept out of the page so they can be tested.
 *
 * Mirrors `docs/runbooks/operator-access.md` §4 in assay-backend: which roles
 * may approve each register row, who may reject, and what each refusal means.
 */

/** What each queued action does, in plain words. */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  "slash.suspend": "Suspend a penalty (cancels it)",
  "slash.sweep": "Decide every penalty with the same defect",
  "slash.compensated": "Record a pay-back and close the penalty",
  "account.unblock": "Lift an account block",
  "operator.add": "Add an operator",
  "operator.change": "Raise someone's roles or limit, or take their Admin role away",
  "operator.remove": "Remove an operator who is an Admin",
  "arbiter.block": "Block a wallet on chain (the arbiter signs it)",
  "tool_version.publish": "Publish a new version of a standard tool",
  "tool.current_version": "Change the version of a tool agents get by default",
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
  "A-14": ["OPS_ADMIN"],
  "A-11": ["ADJL"],
  "P-10": ["POLA"],
  "P-11": ["POLA"],
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
  return `Only ${rolePhrase(required)} can approve this.`;
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
  /** Penalty id → "Northwind Geo's $28.47 penalty", for the ones already read. */
  readonly penalties?: ReadonlyMap<string, string>;
  /** Penalty id → its provider and amount apart, for the money line of a confirm. */
  readonly penaltyParts?: ReadonlyMap<string, { readonly provider: string; readonly amount: string }>;
  /** Tool id → its name and versions, for contract requests (`tool:<id>`). */
  readonly tools?: ReadonlyMap<string, ApprovalToolInfo>;
}

/** What a contract request names: the tool, its versions by sequence number, and the draft's next number. */
export interface ApprovalToolInfo {
  readonly name: string;
  /** Sequence number → semver, published versions and the draft (as its next semver). */
  readonly semvers: ReadonlyMap<number, string>;
  /** The draft's sequence number and computed bump, when there is one. */
  readonly draft?: { readonly version: number; readonly bump: "PATCH" | "MINOR" | "MAJOR" | null } | null;
}

/** "get_weather v2.1.0", "get_weather" when the version is not known. */
function toolVersionName(context: ApprovalContext, toolId: string, version: unknown): string {
  const tool = context.tools?.get(toolId);
  const name = tool?.name ?? `tool ${shortId(toolId)}`;
  const semver = typeof version === "number" ? tool?.semvers.get(version) : undefined;
  return semver ? `${name} v${semver}` : name;
}

export const EMPTY_APPROVAL_CONTEXT: ApprovalContext = {
  blocks: new Map(),
  operators: new Map(),
  asset: null,
  penalties: new Map(),
};

/** "Northwind Geo's $28.47 penalty", "Helios Data Labs' $12.40 penalty". */
export function penaltyPhrase(providerName: string, amount: string): string {
  const owner = /s$/i.test(providerName) ? `${providerName}'` : `${providerName}'s`;
  return `${owner} ${amount} penalty`;
}

export interface ApprovalDescription {
  /** One sentence: what approving runs. */
  readonly sentence: string;
  /**
   * The short form for a list row and a confirm title: no reason, no
   * trailing period ("Pay back Meridian Index's $3.75 penalty").
   */
  readonly title: string;
  /** The request's reason in words ("Key rotated"), or null. */
  readonly reason: string | null;
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
  return roles.length === 0 ? "no role" : roles.map((role) => ROLE_LABEL[role] ?? role).join(", ");
}

function rolesLong(roles: readonly string[]): string {
  return rolesText(roles);
}

/** "a Lead adjudicator", "an Adjudicator or a Lead adjudicator". */
export function rolePhrase(roles: readonly string[]): string {
  const names = roles.map((role) => {
    const name = ROLE_LABEL[role] ?? role;
    return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`;
  });
  if (names.length <= 1) return names[0] ?? "another operator";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** `KEY_ROTATED` → "Key rotated". */
export function reasonText(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `0x07cd29…` → `0x07cd…4D711` checksummed; anything else unchanged. */
function shortEvm(address: string): string {
  return shortAddress("eip155:1", toChecksumAddress(address));
}

/**
 * A limit as Team, its sheets and Approvals write it: whole dollars without
 * cents ("$0", "$1,000"), cents only when there are some ("$2.50"). One rule
 * for every authority limit in the console.
 */
export function limitMoney(money: Money): string {
  return formatMoney(money).replace(/\.00$/, "");
}

/** Minor units off the wire → a limit as `limitMoney` writes it, `unbounded`, or the bare count when the asset is unknown. */
export function limitText(minor: unknown, asset: ApprovalContext["asset"]): string | null {
  if (minor === null) return "unbounded";
  const amount = text(minor);
  if (amount === null || !/^[0-9]+$/.test(amount)) return null;
  if (asset) return limitMoney({ amount, asset: asset.asset, decimals: asset.decimals });
  return amount === "0" ? "$0" : `${amount} minor units`;
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
  if (reason) fields.push({ label: "Reason", value: reasonText(reason) });
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

/** A penalty in words: its provider and amount when read, else "penalty 0a6d3b9e…". */
function penaltyName(id: string, context: ApprovalContext): string {
  return context.penalties?.get(id) ?? `penalty ${shortId(id)}`;
}

function caseTarget(id: string, context: ApprovalContext) {
  const name = penaltyName(id, context);
  return { label: name.charAt(0).toUpperCase() + name.slice(1), href: routes.operatorCase(id) };
}

/**
 * An approval in plain words: the sentence an approver reads, the target
 * resolved to what it names, and the request's fields with labels.
 *
 * BUG-R15-OP-01: the card showed `authorityLimitMinor 0` and "Block 7b2acf05-…",
 * so an approver could not tell which account a lift was for.
 */
export function describeApproval(
  approval: Pick<OperatorApproval, "action" | "target" | "payload"> & Partial<Pick<OperatorApproval, "status">>,
  context: ApprovalContext = EMPTY_APPROVAL_CONTEXT,
): ApprovalDescription {
  const body = bodyOf(approval.payload);
  const reason = text(body.reasonCode);
  return {
    ...describeLong(approval, context),
    title: approvalTitle(approval, context),
    reason: reason ? reasonText(reason) : null,
  };
}

function bodyOf(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const outer = payload ?? {};
  return outer.body && typeof outer.body === "object" && !Array.isArray(outer.body) ? (outer.body as Record<string, unknown>) : outer;
}

function capitalFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A person in a title: their name, else their handle, else a short id. */
function personName(
  operator: Pick<OperatorDirectoryEntry, "subject" | "displayName"> | undefined,
  id: string,
): string {
  return operator?.displayName?.trim() || operator?.subject || `operator ${shortId(id)}`;
}

/**
 * A person known by their handle (`jordan@`): their display name from the
 * directory. A handle nobody in the directory holds is shown as it is.
 */
function subjectName(subject: string, context: ApprovalContext): string {
  for (const operator of context.operators.values()) {
    if (operator.subject === subject) return personName(operator, subject);
  }
  return subject;
}

/** "Noor Hassan's", "Iris'": a possessive that reads right after an s. */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * The short title of a request, for a list row (≤ 70 characters in practice)
 * and the confirm sheet. Sentence case, no period, no reason.
 */
export function approvalTitle(
  approval: Pick<OperatorApproval, "action" | "target" | "payload">,
  context: ApprovalContext = EMPTY_APPROVAL_CONTEXT,
): string {
  const payload = approval.payload ?? {};
  const body = bodyOf(payload);
  const colon = approval.target.indexOf(":");
  const targetId = colon === -1 ? "" : approval.target.slice(colon + 1);
  switch (approval.action) {
    case "account.unblock": {
      const blockId = text(payload.blockId) ?? targetId;
      const block = context.blocks.get(blockId);
      return `Lift the block on ${block ? capitalFirst(blockSubject(block)) : `block ${shortId(blockId)}`}`;
    }
    case "operator.add": {
      const name = text(body.displayName) ?? text(body.subject) ?? "a new operator";
      const roles = rolesOf(body.roles) ?? [];
      return roles.length > 0 ? `Add ${name} as ${rolesText(roles)}` : `Add ${name} as an operator`;
    }
    case "operator.change": {
      const operatorId = text(payload.operatorId) ?? targetId;
      const who = personName(context.operators.get(operatorId), operatorId);
      const roles = rolesOf(body.roles);
      const hasLimit = Object.prototype.hasOwnProperty.call(body, "authorityLimitMinor");
      const limit = hasLimit ? limitText(body.authorityLimitMinor, context.asset) : null;
      if (roles && limit) return `Change ${possessive(who)} roles and limit`;
      if (roles) return `Make ${who} ${rolesText(roles)}`;
      if (limit) return `Raise ${possessive(who)} limit to ${limit.replace(/\.00$/, "")}`;
      return `Change ${possessive(who)} access`;
    }
    case "slash.suspend":
      return `Suspend ${penaltyName(text(payload.proposalId) ?? targetId, context)}`;
    case "slash.sweep": {
      const defect = text(body.defectKey);
      return defect ? `Decide every penalty with defect ${defect}` : "Decide every penalty with the same defect";
    }
    case "slash.compensated":
      return `Pay back ${penaltyName(text(payload.proposalId) ?? targetId, context)}`;
    case "arbiter.block": {
      // The two most dangerous requests name who they are about (operator review 2026-10-16b, P1-6).
      const account = text(payload.account) ?? targetId.split(":").pop() ?? "";
      const chainId = text(payload.chainId);
      return `Block wallet ${account ? shortEvm(account) : "?"} on chain${chainId ? ` (${chainDisplayName(chainId)})` : ""}`;
    }
    case "operator.remove": {
      const operatorId = text(payload.operatorId) ?? targetId;
      const operator = context.operators.get(operatorId);
      const who = personName(operator, operatorId);
      return operator ? `Remove ${who} (${rolesText(operator.roles)})` : `Remove ${who}`;
    }
    case "tool_version.publish":
      return `Publish ${toolVersionName(context, text(payload.toolId) ?? targetId, payload.version)}`;
    case "tool.current_version":
      return `Make ${toolVersionName(context, text(payload.toolId) ?? targetId, body.version)} the default for agents`;
    default:
      return actionLabel(approval.action);
  }
}

/** One line of what approving does, for the confirm's "What happens". */
export interface ApprovalOutcomeLine {
  readonly kind: "money" | "access" | "chain" | "runs" | "record";
  readonly text: string;
}

/**
 * What approving does, in short lines, money first: "Treasury pays $3.75 to
 * Meridian Index", "Wallet 0x9F3c…F36c can pay again within seconds". The
 * last line is always where it is recorded.
 */
export function approvalOutcome(
  approval: Pick<OperatorApproval, "action" | "target" | "payload">,
  context: ApprovalContext = EMPTY_APPROVAL_CONTEXT,
): ApprovalOutcomeLine[] {
  const payload = approval.payload ?? {};
  const body = bodyOf(payload);
  const colon = approval.target.indexOf(":");
  const targetId = colon === -1 ? "" : approval.target.slice(colon + 1);
  const lines: ApprovalOutcomeLine[] = [];
  const penaltyId = text(payload.proposalId) ?? targetId;
  const parts = context.penaltyParts?.get(penaltyId);
  switch (approval.action) {
    case "slash.compensated":
      // The treasury's deposit already happened (its signature is in the request): approving records it.
      lines.push({
        kind: "money",
        text: parts
          ? `Records that the treasury paid ${parts.amount} back into ${possessive(parts.provider)} stake`
          : "Records that the treasury paid the penalty back into the provider's stake",
      });
      lines.push({ kind: "record", text: "The penalty closes as paid back. It can't be undone" });
      break;
    case "slash.suspend":
      lines.push({
        kind: "money",
        text: parts ? `The penalty is cancelled: ${parts.provider} keeps its ${parts.amount}` : "The penalty is cancelled: the provider keeps the amount",
      });
      lines.push({ kind: "chain", text: "If it stands on chain, the arbiter must still sign the cancel. It can't be undone" });
      break;
    case "arbiter.block": {
      const account = text(payload.account);
      const chainId = text(payload.chainId);
      lines.push({
        kind: "chain",
        text: `Builds the arbiter's unsigned block of ${account ? `wallet ${shortEvm(account)}` : "the wallet"}${chainId ? ` on ${chainDisplayName(chainId)}` : ""}. Nothing is blocked on chain until the arbiter's wallet signs it`,
      });
      lines.push({ kind: "access", text: "Once it lands, only the contracts' admin key can lift it on chain" });
      break;
    }
    case "operator.remove": {
      const operatorId = text(payload.operatorId) ?? targetId;
      const who = personName(context.operators.get(operatorId), operatorId);
      lines.push({ kind: "access", text: `${who} is removed, and every session they hold ends now` });
      lines.push({ kind: "record", text: "It can't be undone: adding them back is a new request" });
      break;
    }
    case "slash.sweep":
      lines.push({ kind: "record", text: "Every matching penalty is decided like this one, in the background" });
      break;
    case "tool_version.publish": {
      const toolId = text(payload.toolId) ?? targetId;
      const draft = context.tools?.get(toolId)?.draft;
      const bump = draft && draft.version === payload.version ? draft.bump : null;
      lines.push({
        kind: "runs",
        text:
          bump === "MAJOR"
            ? "Providers can serve the new version once they re-map and pass a test for it. Agents keep the current version until it is made the default"
            : "Agents and providers get the new version at once. Nothing they rely on breaks",
      });
      lines.push({ kind: "record", text: "A published version can't be unpublished" });
      break;
    }
    case "tool.current_version":
      lines.push({ kind: "runs", text: "Agents that don't lock a version move to it at once. Locked URLs keep their version" });
      lines.push({ kind: "record", text: "It can be moved back with another request" });
      break;
    case "account.unblock": {
      const block = context.blocks.get(text(payload.blockId) ?? targetId);
      const who = block ? capitalFirst(blockSubject(block)) : "The account";
      lines.push({
        kind: "access",
        text: block?.subjectKind === "WALLET" ? `${who} can pay again within seconds` : `${who} can use Assay again within seconds`,
      });
      break;
    }
    case "operator.add": {
      const name = text(body.displayName) ?? text(body.subject) ?? "They";
      lines.push({ kind: "access", text: `${name} can sign in with their wallet at once` });
      break;
    }
    case "operator.change": {
      const operatorId = text(payload.operatorId) ?? targetId;
      lines.push({
        kind: "access",
        text: `${possessive(personName(context.operators.get(operatorId), operatorId))} new access applies from their next request`,
      });
      break;
    }
    default:
      break;
  }
  lines.push({ kind: "runs", text: "Runs at once, re-checked against how things stand now" });
  lines.push({ kind: "record", text: "Recorded in Activity under your name" });
  return lines;
}

function describeLong(
  approval: Pick<OperatorApproval, "action" | "target" | "payload"> & Partial<Pick<OperatorApproval, "status">>,
  context: ApprovalContext,
): Omit<ApprovalDescription, "title" | "reason"> {
  // Absent status: treat as pending, the only state where "now" is the point.
  const pending = (approval.status ?? "PENDING") === "PENDING";
  const payload = approval.payload ?? {};
  const body =
    payload.body && typeof payload.body === "object" && !Array.isArray(payload.body)
      ? (payload.body as Record<string, unknown>)
      : payload;
  const colon = approval.target.indexOf(":");
  const targetId = colon === -1 ? "" : approval.target.slice(colon + 1);
  const reason = text(body.reasonCode);
  const because = reason ? ` (${reasonText(reason).toLowerCase()})` : "";

  switch (approval.action) {
    case "account.unblock": {
      const blockId = text(payload.blockId) ?? targetId;
      const block = context.blocks.get(blockId);
      const who = block ? blockSubject(block) : `block ${shortId(blockId)}`;
      const fields: { label: string; value: string }[] = [];
      if (block) {
        fields.push({ label: "Blocked for", value: `${reasonText(block.reasonCode)} · by ${subjectName(block.blockedBy, context)}` });
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
      const fullEmail = /^[^@\s]+@[^@\s]+$/.test(subject);
      const roles = rolesOf(body.roles) ?? [];
      const limit = limitText(body.authorityLimitMinor === undefined ? "0" : body.authorityLimitMinor, context.asset);
      const fields = [
        // A full email adds something after the name; a bare `noor@` handle is derived from it and does not.
        { label: "Operator", value: name && name !== subject ? (fullEmail ? `${name} (${subject})` : name) : subject },
        { label: "Wallet", value: toChecksumAddress(wallet) },
        { label: "Roles", value: rolesLong(roles) },
        ...(limit ? [{ label: "Authority limit", value: limit }] : []),
      ];
      return {
        sentence: `Add operator ${fullEmail || !name ? subject : name} with wallet ${shortEvm(wallet)}, roles ${rolesText(roles)}${limit ? `, limit ${limit}` : ""}${because}.`,
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
      const demotes =
        roles !== null && operator !== undefined && operator.roles.includes("OPS_ADMIN") && !roles.includes("OPS_ADMIN");
      const sentence = demotes
        ? `Take the Admin role away from ${who}: roles become ${rolesText(roles ?? [])}`
        : roles && limit
          ? `Raise the roles of ${who} to ${rolesText(roles)} and the authority limit to ${limit}`
          : roles
            ? `Raise the roles of ${who} to ${rolesText(roles)}`
            : limit
              ? `Raise the authority limit of ${who} to ${limit}`
              : `Change the access of ${who}`;
      const fields: { label: string; value: string }[] = [];
      if (operator?.walletAddress) fields.push({ label: "Wallet", value: toChecksumAddress(operator.walletAddress) });
      if (pending) {
        // Pending: the live row is what approving would change.
        if (operator) fields.push({ label: "Roles now", value: rolesText(operator.roles) });
        if (roles) fields.push({ label: "New roles", value: rolesLong(roles) });
        if (operator && hasLimit) {
          fields.push({
            label: "Limit now",
            value: operator.authorityLimit === null ? "unbounded" : limitMoney(operator.authorityLimit),
          });
        }
        if (limit) fields.push({ label: "New limit", value: limit });
      } else {
        // Decided: the live row says nothing about this request. Show what was
        // asked for, and what it replaced when the payload recorded that.
        const before =
          payload.before && typeof payload.before === "object" && !Array.isArray(payload.before)
            ? (payload.before as Record<string, unknown>)
            : {};
        const rolesBefore = rolesOf(before.roles);
        const limitBefore = Object.prototype.hasOwnProperty.call(before, "authorityLimitMinor")
          ? limitText(before.authorityLimitMinor, context.asset)
          : null;
        if (rolesBefore) fields.push({ label: "Roles before (at request time)", value: rolesText(rolesBefore) });
        if (roles) fields.push({ label: "Roles requested (at request time)", value: rolesLong(roles) });
        if (limitBefore) fields.push({ label: "Limit before (at request time)", value: limitBefore });
        if (limit) fields.push({ label: "Limit requested (at request time)", value: limit });
      }
      return {
        sentence: `${sentence}${because}.`,
        target: { label: operator ? `Operator ${operator.subject}` : `Operator ${shortId(operatorId)}`, href: "/operator/operators" },
        fields: [...fields, ...commonFields(body), ...extraFields(body)],
      };
    }

    case "operator.remove": {
      const operatorId = text(payload.operatorId) ?? targetId;
      const operator = context.operators.get(operatorId);
      const who = operatorName(operator, operatorId);
      return {
        sentence: `Remove ${who}, ending every session they hold${because}.`,
        target: { label: operator ? `Operator ${operator.subject}` : `Operator ${shortId(operatorId)}`, href: "/operator/operators" },
        fields: [
          ...(operator ? [{ label: "Roles now", value: rolesText(operator.roles) }] : []),
          ...commonFields(body),
          ...extraFields(body),
        ],
      };
    }

    case "arbiter.block": {
      const account = text(payload.account) ?? targetId;
      const chainId = text(payload.chainId);
      return {
        sentence: `Block wallet ${account} on chain${chainId ? ` (${chainDisplayName(chainId)})` : ""}${because}. Approving builds the unsigned call; the arbiter's wallet still has to sign it.`,
        target: { label: `Wallet ${shortEvm(account)}`, href: "/operator/arbiter" },
        fields: [
          { label: "Wallet", value: account },
          ...(chainId ? [{ label: "Chain", value: chainDisplayName(chainId) }] : []),
          ...commonFields(body),
          ...extraFields(body),
        ],
      };
    }

    case "slash.suspend": {
      const id = text(payload.proposalId) ?? targetId;
      return {
        sentence: `Suspend ${penaltyName(id, context)}, which cancels it${because}.`,
        target: caseTarget(id, context),
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
        sentence: `Sweep every penalty with defect ${defect ?? "?"} over the last ${hours ?? "?"} h, decided like ${penaltyName(id, context)}${because}.`,
        target: caseTarget(id, context),
        fields: [...fields, ...commonFields(body), ...extraFields(body)],
      };
    }

    case "slash.compensated": {
      const id = text(payload.proposalId) ?? targetId;
      const signature = text(body.signature);
      return {
        sentence: `Record that ${penaltyName(id, context)} was paid back, and close it as compensated${because}.`,
        target: caseTarget(id, context),
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

/** A requester rejecting their own request withdrew it. */
export function isWithdrawn(approval: Pick<OperatorApproval, "status" | "rejectedBy" | "requestedBy">): boolean {
  return approval.status === "REJECTED" && approval.rejectedBy !== null && approval.rejectedBy === approval.requestedBy;
}

/** The status word on a card: `withdrawn` for a request its requester took back. */
export function statusWord(approval: Pick<OperatorApproval, "status" | "rejectedBy" | "requestedBy">): string {
  return isWithdrawn(approval) ? "withdrawn" : approval.status.toLowerCase();
}

/**
 * Who asked and who decided, in one line: "Asked by A · approved by B",
 * "Asked by A · rejected by B", "Asked and withdrawn by A", "Asked by A ·
 * expired". `nameOf` turns a subject into the name the console shows.
 */
export function decisionText(
  approval: Pick<OperatorApproval, "status" | "approvedBy" | "rejectedBy" | "requestedBy">,
  nameOf: (subject: string) => string = (subject) => subject,
): string {
  const asker = nameOf(approval.requestedBy);
  if (isWithdrawn(approval)) return `Asked and withdrawn by ${asker}`;
  if (approval.approvedBy) return `Asked by ${asker} · approved by ${nameOf(approval.approvedBy)}`;
  if (approval.rejectedBy) return `Asked by ${asker} · rejected by ${nameOf(approval.rejectedBy)}`;
  return `Asked by ${asker} · ${approval.status.toLowerCase()}`;
}

/**
 * One sentence for what an approval did, from the action's own result.
 * `target` is what the card already calls the record ("Wallet 0x9F3c…F36c");
 * a raw subject off the wire (a CAIP id) is never printed.
 */
export function approvedResultSentence(action: string, result: unknown, target?: string): string {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  switch (action) {
    case "slash.sweep":
      return `Fleet sweep opened: ${String(r.matchedCount ?? "?")} matched, ${String(r.appliedCount ?? "?")} applied.`;
    case "slash.suspend":
      return `${target ? `${target.charAt(0).toUpperCase()}${target.slice(1)} suspended` : "Penalty suspended"}. If it stands on chain, its cancel is requested and still needs the arbiter's signature.`;
    case "slash.compensated":
      return `${target ? `${target.charAt(0).toUpperCase()}${target.slice(1)} recorded as paid back` : "Recorded as paid back"} into the provider's stake. Penalty closed.`;
    case "account.unblock": {
      const subject =
        target ??
        (typeof r.subject === "string"
          ? r.subjectKind === "ORGANIZATION"
            ? `organization ${shortId(r.subject)}`
            : walletLabel(r.subject)
          : null);
      return `Block lifted${subject ? ` on ${subject}` : ""}.`;
    }
    case "operator.add":
      return `Operator added${typeof r.subject === "string" ? `: ${r.subject}` : ""}. They can sign in with their wallet now.`;
    case "operator.change":
      return `Operator changed${typeof r.subject === "string" ? `: ${r.subject}` : ""}.`;
    case "operator.remove":
      return `Operator removed${typeof r.subject === "string" ? `: ${r.subject}` : ""}. Every session they held has ended.`;
    case "tool_version.publish":
      return "Published. Providers and the catalogue see the new version now.";
    case "tool.current_version":
      return "Done. Agents that don't lock a version now get the new one.";
    case "arbiter.block":
      // "Below" only when the answer carried the call, which the screen then draws under this line.
      return typeof r.to === "string" && typeof r.data === "string"
        ? "Approved. The arbiter's unsigned block is ready below, and on Arbiter. Nothing is blocked on chain until the arbiter's wallet signs and sends it."
        : "Approved. Nothing is blocked on chain yet: the arbiter's wallet signs it from Arbiter, under On-chain blocks to sign.";
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
  // The code is not part of the sentence: screens show it under Details.
  const tail = "";
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
        return "The action was re-checked against how things stand now and refused. It is still pending: retry once the cause is fixed, reject it, or let it expire.";
      }
      return `${error.message}${tail}`;
  }
}

/** The pending badge: a count, `100+` past one page. */
export function pendingBadge(count: number, hasMore: boolean): string | null {
  if (count <= 0) return null;
  return hasMore ? `${count}+` : String(count);
}

// ── Before → after, and where it leads ──────────────────────────────────────

export interface ApprovalChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/**
 * What approving changes, as before → after rows for the confirm step and the
 * card. Read off the request and what the inbox already knows; an unknown
 * "before" is said as such rather than guessed.
 */
export function approvalChanges(
  approval: Pick<OperatorApproval, "action" | "target" | "payload">,
  context: ApprovalContext = EMPTY_APPROVAL_CONTEXT,
): ApprovalChange[] {
  const payload = approval.payload ?? {};
  const body =
    payload.body && typeof payload.body === "object" && !Array.isArray(payload.body)
      ? (payload.body as Record<string, unknown>)
      : payload;
  const colon = approval.target.indexOf(":");
  const targetId = colon === -1 ? "" : approval.target.slice(colon + 1);

  switch (approval.action) {
    case "account.unblock": {
      const block = context.blocks.get(text(payload.blockId) ?? targetId);
      return [{ label: "Account", before: block && !block.active ? "Already lifted" : "Blocked", after: "Can use Assay again" }];
    }
    case "operator.add": {
      const roles = rolesOf(body.roles) ?? [];
      const limit = limitText(body.authorityLimitMinor === undefined ? "0" : body.authorityLimitMinor, context.asset);
      return [
        { label: "Access", before: "Not an operator", after: rolesText(roles) },
        ...(limit ? [{ label: "Authority limit", before: "None", after: limit }] : []),
      ];
    }
    case "operator.change": {
      const operator = context.operators.get(text(payload.operatorId) ?? targetId);
      const changes: ApprovalChange[] = [];
      const roles = rolesOf(body.roles);
      if (roles) changes.push({ label: "Roles", before: operator ? rolesText(operator.roles) : "Unknown", after: rolesText(roles) });
      if (Object.prototype.hasOwnProperty.call(body, "authorityLimitMinor")) {
        changes.push({
          label: "Authority limit",
          before: operator ? (operator.authorityLimit === null ? "unbounded" : limitMoney(operator.authorityLimit)) : "Unknown",
          after: limitText(body.authorityLimitMinor, context.asset) ?? "Unknown",
        });
      }
      return changes;
    }
    case "slash.suspend":
      return [{ label: "Penalty", before: "Stands", after: "Cancelled" }];
    case "slash.compensated":
      return [{ label: "Penalty", before: "Executed", after: "Paid back to the provider" }];
    case "slash.sweep":
      return [{ label: "Cases with this defect", before: "Open", after: "Decided like this one" }];
    default:
      return [];
  }
}

/** The id the request is about (`account_block:blk-2` → `blk-2`). */
export function approvalTargetId(approval: Pick<OperatorApproval, "target" | "payload">): string {
  const payload = approval.payload ?? {};
  const fromPayload = text(payload.blockId) ?? text(payload.proposalId) ?? text(payload.operatorId);
  if (fromPayload) return fromPayload;
  const colon = approval.target.indexOf(":");
  return colon === -1 ? approval.target : approval.target.slice(colon + 1);
}

/** The Activity log, filtered to what the request is about. */
export function approvalActivityHref(approval: Pick<OperatorApproval, "target" | "payload">): string {
  return `/operator/override-log?targetId=${encodeURIComponent(approvalTargetId(approval))}`;
}

/**
 * Who must approve a register code, for `ApprovalFooter` and the request row.
 * Said from the requester's side when their roles are known: "a second Lead
 * adjudicator" only when the requester holds that role too, otherwise "a Lead
 * adjudicator" / "an Admin" (Support asking to lift a block needs a Lead
 * adjudicator, not a second one). Without them, "a second …" as before.
 *
 *   approvalNeeds("A-10")                  → "a second Lead adjudicator"
 *   approvalNeeds("A-10", ["SRE", "SUP"])  → "a Lead adjudicator"
 *   approvalNeeds("A-10", ["ADJL"])        → "a second Lead adjudicator"
 */
export function approvalNeeds(code: string, requesterRoles?: readonly OperatorRole[]): string {
  const roles = approverRolesFor(code);
  if (!roles || roles.length === 0) return "a second operator";
  const names = roles.map((role) => ROLE_LABEL[role] ?? role);
  const joined = names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  if (!requesterRoles || requesterRoles.some((role) => roles.includes(role))) return `a second ${joined}`;
  return `${/^[AEIOU]/i.test(joined) ? "an" : "a"} ${joined}`;
}
