import Decimal from "decimal.js";

import { parseCaps } from "@/features/buyer-money/caps";
import { relayRetryAt } from "@/features/escrow/relayed-refusal";
import { displayClientName } from "@/features/oauth/consent";
import type { EscrowDelegate } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { formatDecimal, toDecimal } from "@/utils/money";

import { MAX_DELEGATION_DAYS, findDelegation } from "./delegation-form";

/**
 * `{WEB}/agents/enable-paid?credential={id}#key={address}` (spec F4 step 5,
 * R-PAY-1, R-PAY-2), as pure logic over its four data sources: `GET /agents`,
 * `GET /agents/:agentId/credentials`, `GET /escrow` and `GET /escrow/delegates`.
 *
 * The page only offers Approve once every check below holds, in this order:
 * the credential is the signed-in account's, it is live, its client may hold a
 * payment key (the built-in `assay-mcp` client, or an API key), the key in the
 * link's fragment (put there by `assay-mcp` on this computer, never by a
 * server) equals the key bound to the credential, and the chain has paid
 * calls. Approve itself is gated on the person ticking that the fingerprint
 * matches what their app showed.
 */

export const ENABLE_PAID_STRINGS = {
  keyMismatch: "This link doesn't match the payment key bound to this app. Don't approve.",
  missingKey: "This link is missing its payment key. Open the link your app showed again.",
  notPaymentClient: "This app can't hold a payment key.",
  signedOut: "This app was signed out. Sign in again from the app.",
  notFound: "This app isn't on the account you are signed in with. Sign in with the account your app uses.",
  noRail: "Paid calls aren't available on this network yet.",
  alreadyOn: "Paid calls are already on for this key",
  done: "Paid calls are on. Go back to your app and ask again.",
  blocked: "Your account is blocked, so paid calls can't be turned on now.",
  registeredByApp: "Registered by Assay app on this computer",
  registeredByKey: "Registered with an API key",
  approve: "Approve",
  renew: "Renew",
} as const;

/** Light: $0.50 a call, $5 per 24 hours, for 30 days (spec G7, O2). */
export const DEFAULT_CAPS = { perCall: "0.50", perDay: "5", days: "30" } as const;
/** A grant with this many days left or fewer is offered "Renew for 30 days". */
export const RENEW_WITHIN_DAYS = 7;

const DAY_MS = 86_400_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type PaymentKeyFragment = { kind: "key"; address: string } | { kind: "missing" } | { kind: "malformed" };

/** The `#key=` of the link, as `assay-mcp` wrote it. */
export function readPaymentKey(hash: string | null | undefined): PaymentKeyFragment {
  if (!hash || hash === "#") return { kind: "missing" };
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("key");
  if (value === null || value === "") return { kind: "missing" };
  return ADDRESS.test(value) ? { kind: "key", address: value } : { kind: "malformed" };
}

/** The last 8 hex characters of the key, upper case, in two groups: `1A2B 9F3C` (spec §3). */
export function fingerprint(account: string): string {
  const tail = addressOfAccount(account).slice(-8).toUpperCase();
  return `${tail.slice(0, 4)} ${tail.slice(4)}`;
}

/** What `GET /agents/:agentId/credentials` returns, as far as this page reads it. */
export interface EnablePaidCredential {
  id: string;
  agentId: string;
  name: string;
  issuedVia?: "API_KEY" | "OAUTH";
  oauthClient?: { name: string; paymentClient: boolean } | null;
  expiresAt: string | null;
  revokedAt: string | null;
  delegateAccount?: string | null;
}

export interface EnablePaidInput {
  credentialId: string | null;
  /** The raw `key` value of the fragment, or null when there is none. */
  fragmentKey: string | null;
  agents: readonly { agentId: string; label?: string }[];
  credentials: Readonly<Record<string, readonly EnablePaidCredential[]>>;
  delegates: readonly EscrowDelegate[] | undefined;
  nowMs: number;
  /** Whether the chain has paid calls (`servesPaidCalls`). */
  servesPaid: (chainId: string) => boolean;
}

export type EnablePaidRefusal = "not-found" | "signed-out" | "not-payment-client" | "missing-key" | "key-mismatch" | "no-rail";

export type GrantState =
  | { kind: "none" }
  | { kind: "active"; delegation: EscrowDelegate; daysLeft: number }
  | { kind: "expiring"; delegation: EscrowDelegate; daysLeft: number };

export type EnablePaidState =
  | { kind: "refused"; reason: EnablePaidRefusal; text: string }
  | {
      kind: "ready";
      credential: EnablePaidCredential;
      agentLabel: string;
      title: string;
      registeredBy: string;
      /** The key as the link named it. */
      address: string;
      /** CAIP-10 as the credential holds it. */
      delegateAccount: string;
      chainId: string;
      fingerprint: string;
      keyCheck: string;
      grant: GrantState;
      /** "Paid calls are already on for this key", when it is. */
      notice: string | null;
      actionLabel: string;
      /** A grant's own caps, the form's starting values on a renewal. */
      renewCaps: { perCall: string; perDay: string } | null;
    };

function refuse(reason: EnablePaidRefusal, text: string): EnablePaidState {
  return { kind: "refused", reason, text };
}

function live(credential: EnablePaidCredential, nowMs: number): boolean {
  if (credential.revokedAt) return false;
  return !credential.expiresAt || Date.parse(credential.expiresAt) > nowMs;
}

/** The OAuth grant of a payment client (`assay-mcp`), or an API key. Never a hosted or third-party grant (H2). */
function mayHoldPaymentKey(credential: EnablePaidCredential): boolean {
  if (credential.issuedVia === "OAUTH") return credential.oauthClient?.paymentClient === true;
  return credential.issuedVia === "API_KEY" || (credential.issuedVia === undefined && !credential.oauthClient);
}

export function grantState(delegation: EscrowDelegate | null, nowMs: number): GrantState {
  if (!delegation || delegation.status !== "ACTIVE") return { kind: "none" };
  const left = Date.parse(delegation.validUntil) - nowMs;
  if (!(left > 0)) return { kind: "none" };
  const daysLeft = Math.ceil(left / DAY_MS);
  return daysLeft <= RENEW_WITHIN_DAYS ? { kind: "expiring", delegation, daysLeft } : { kind: "active", delegation, daysLeft };
}

export function enablePaidState(input: EnablePaidInput): EnablePaidState {
  const credential = input.credentialId
    ? Object.values(input.credentials)
        .flat()
        .find((c) => c.id === input.credentialId)
    : undefined;
  if (!credential) return refuse("not-found", ENABLE_PAID_STRINGS.notFound);
  if (!live(credential, input.nowMs)) return refuse("signed-out", ENABLE_PAID_STRINGS.signedOut);
  if (!mayHoldPaymentKey(credential)) return refuse("not-payment-client", ENABLE_PAID_STRINGS.notPaymentClient);
  if (input.fragmentKey === null || input.fragmentKey === "") return refuse("missing-key", ENABLE_PAID_STRINGS.missingKey);
  const bound = credential.delegateAccount ?? null;
  const boundAddress = addressOfAccount(bound);
  if (!ADDRESS.test(input.fragmentKey) || !bound || !ADDRESS.test(boundAddress)) {
    return refuse("key-mismatch", ENABLE_PAID_STRINGS.keyMismatch);
  }
  if (input.fragmentKey.toLowerCase() !== boundAddress.toLowerCase()) {
    return refuse("key-mismatch", ENABLE_PAID_STRINGS.keyMismatch);
  }
  const chainId = chainIdOfAccount(bound);
  if (!chainId || !chainId.startsWith("eip155:") || !input.servesPaid(chainId)) {
    return refuse("no-rail", ENABLE_PAID_STRINGS.noRail);
  }

  const grant = grantState(findDelegation(input.delegates, bound), input.nowMs);
  const fp = fingerprint(bound);
  const name = displayClientName(credential.name, { builtin: true });
  const agent = input.agents.find((a) => a.agentId === credential.agentId);
  return {
    kind: "ready",
    credential,
    agentLabel: agent?.label || credential.agentId,
    title: `Turn on paid calls for ${name}`,
    registeredBy:
      credential.issuedVia === "OAUTH" ? ENABLE_PAID_STRINGS.registeredByApp : ENABLE_PAID_STRINGS.registeredByKey,
    address: input.fragmentKey,
    delegateAccount: bound,
    chainId,
    fingerprint: fp,
    keyCheck: `Check this matches what your app showed: ${fp}`,
    grant,
    notice: grant.kind === "active" ? ENABLE_PAID_STRINGS.alreadyOn : null,
    actionLabel:
      grant.kind === "active"
        ? ENABLE_PAID_STRINGS.renew
        : grant.kind === "expiring"
          ? `Renew for ${DEFAULT_CAPS.days} days`
          : ENABLE_PAID_STRINGS.approve,
    renewCaps:
      grant.kind === "none"
        ? null
        : {
            perCall: toDecimal(grant.delegation.maxVoucherAmount).toString(),
            perDay: toDecimal(grant.delegation.maxPerWindow).toString(),
          },
  };
}

function decimalOf(value: string): Decimal | null {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(text)) return null;
  return new Decimal(text);
}

/** "$5", "$155", "$0.50". */
export function dollars(value: Decimal): string {
  return value.isInteger() ? formatDecimal(value, { decimals: 0 }) : formatDecimal(value);
}

/** `maxPerWindow × (1 + days)` (spec §11 T1): $155 for $5 a day over 30 days. */
export function lossBound(perDay: string, days: string): string | null {
  const day = decimalOf(perDay);
  const n = decimalOf(days);
  if (!day || !n || !n.isInteger()) return null;
  return dollars(day.times(n.plus(1)));
}

export function boundLine(perDay: string, days: string): string | null {
  const bound = lossBound(perDay, days);
  if (!bound) return null;
  return (
    `Most this key can spend before it expires: ${bound}. ` +
    "One budget covers every Assay server on this computer; your agent's limits apply on top."
  );
}

/** "$0.50" / "$5" for a typed amount, or the text as typed. */
export function amountLabel(value: string): string {
  const d = decimalOf(value);
  return d ? dollars(d) : value;
}

/** The copy above Approve (spec F4 step 5, R-WEB-6). */
export function walletCheckCopy(account: string, perCall: string, perDay: string): string {
  return (
    `In the wallet window, check the payment key ends with ${fingerprint(account).replace(" ", "")} ` +
    `and the limits are ${amountLabel(perCall)} a call and ${amountLabel(perDay)} per 24 hours.`
  );
}

export interface CapsDraft {
  perCall: string;
  perDay: string;
  days: string;
}

export type ParsedEnablePaidCaps =
  | { ok: true; maxVoucherAmount: string; maxPerWindow: string; days: number }
  | { ok: false; perCall: string | null; perDay: string | null; days: string | null };

/** The caps in atomic units, or why not. A call never above the day; 1 to 365 days, as the chain allows. */
export function parseEnablePaidCaps(draft: CapsDraft, decimals: number): ParsedEnablePaidCaps {
  const caps = parseCaps(draft.perCall, draft.perDay, decimals);
  const zero = (atomic: string | null) => atomic !== null && BigInt(atomic) === 0n;
  const perCall = caps.perCall.error ?? (zero(caps.perCall.atomic) ? "Must be above zero." : null);
  const perDay = caps.perDay.error ?? (zero(caps.perDay.atomic) ? "Must be above zero." : null);
  const n = draft.days.trim();
  const days =
    /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= MAX_DELEGATION_DAYS ? null : `Between 1 and ${MAX_DELEGATION_DAYS} days.`;
  if (perCall || perDay || days || !caps.perCall.atomic || !caps.perDay.atomic) {
    return { ok: false, perCall, perDay, days };
  }
  return { ok: true, maxVoucherAmount: caps.perCall.atomic, maxPerWindow: caps.perDay.atomic, days: Number(n) };
}

export type PlannedSignature = "SET_LIMITS" | "AUTHORIZE_DELEGATE";

/**
 * `SetLimits` only when the escrow's ceiling (atomic) is below the caps, then
 * `AuthorizeDelegate`: the chain refuses a grant above the ceiling.
 */
export function planSignatures(
  ceiling: { perCall: string; perWindow: string } | null,
  chosen: { maxVoucherAmount: string; maxPerWindow: string },
): PlannedSignature[] {
  const covers =
    ceiling !== null &&
    BigInt(ceiling.perCall || "0") >= BigInt(chosen.maxVoucherAmount) &&
    BigInt(ceiling.perWindow || "0") >= BigInt(chosen.maxPerWindow);
  return covers ? ["AUTHORIZE_DELEGATE"] : ["SET_LIMITS", "AUTHORIZE_DELEGATE"];
}

/** The page's own sentence for a failure, or null to use the money screens' wording. */
export function enablePaidFailure(error: unknown, nowMs: number = Date.now()): string | null {
  if (!(error instanceof ApiError) || error.code !== "SETTLEMENT_RELAYED_INTENT_RATE_LIMITED") return null;
  const at = relayRetryAt(error.message);
  if (!at) return "Try again in a few minutes.";
  const minutes = Math.max(1, Math.ceil((at.getTime() - nowMs) / 60_000));
  return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export const KEY_STORAGE_KEY = "assay.enablePaid.key";

/**
 * The link's `#key` for this credential: from the fragment (kept for this tab,
 * so a sign-in round trip that drops the fragment finds it again), else the
 * one this tab kept for the same credential. A malformed value is returned as
 * it is, so it is refused as a mismatch. `null`: no key at all.
 */
export function takePaymentKey(credentialId: string, win: Window = window): string | null {
  const raw = win.location.hash ? new URLSearchParams(win.location.hash.replace(/^#/, "")).get("key") : null;
  const fragment = readPaymentKey(win.location.hash);
  let store: Storage | null = null;
  try {
    store = win.sessionStorage;
  } catch {
    store = null;
  }
  if (fragment.kind === "key") {
    try {
      store?.setItem(KEY_STORAGE_KEY, JSON.stringify({ credentialId, key: fragment.address }));
    } catch {
      /* storage refused: this page view still has it */
    }
    return fragment.address;
  }
  if (fragment.kind === "malformed") return raw;
  try {
    const saved = JSON.parse(store?.getItem(KEY_STORAGE_KEY) ?? "null") as { credentialId?: unknown; key?: unknown } | null;
    return saved && saved.credentialId === credentialId && typeof saved.key === "string" && ADDRESS.test(saved.key)
      ? saved.key
      : null;
  } catch {
    return null;
  }
}
