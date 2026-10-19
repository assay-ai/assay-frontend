import Decimal from "decimal.js";

import { parseCaps } from "@/features/buyer-money/caps";
import { relayRetryAt } from "@/features/escrow/relayed-refusal";
import { displayClientName } from "@/features/oauth/consent";
import type { EscrowDelegate } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { safeNextPath } from "@/libs/login-redirect";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";
import { formatDecimal, toDecimal } from "@/utils/money";

import strictRpcOrigins from "@/config/strict-rpc-origins.json";

import { findDelegation } from "./delegation-form";

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
  missingKey:
    "This link is missing its payment key. Open the link your app showed again: it must end with #key=… as printed by your app.",
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
/** The longest grant this page signs: 30 days from the page's own clock (O2). */
export const ENABLE_PAID_MAX_DAYS = 30;
/** How far `GET /escrow`'s `serverTime` may be from this device's clock before the page refuses to sign. */
export const CLOCK_SKEW_LIMIT_SECONDS = 120;
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
  issuedVia: "API_KEY" | "OAUTH";
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
  return credential.issuedVia === "API_KEY";
}

/** Approve; Renew for an active grant; "Renew for {days} days" when it ends within a week. */
export function actionLabelFor(grant: GrantState, days: string): string {
  if (grant.kind === "active") return ENABLE_PAID_STRINGS.renew;
  if (grant.kind === "expiring") return `Renew for ${days.trim() || DEFAULT_CAPS.days} days`;
  return ENABLE_PAID_STRINGS.approve;
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
    actionLabel: actionLabelFor(grant, DEFAULT_CAPS.days),
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

/** The caps in atomic units, or why not. A call never above the day; 1 to 30 days on this page (O2). */
export function parseEnablePaidCaps(draft: CapsDraft, decimals: number): ParsedEnablePaidCaps {
  const caps = parseCaps(draft.perCall, draft.perDay, decimals);
  const zero = (atomic: string | null) => atomic !== null && BigInt(atomic) === 0n;
  const perCall = caps.perCall.error ?? (zero(caps.perCall.atomic) ? "Must be above zero." : null);
  const perDay = caps.perDay.error ?? (zero(caps.perDay.atomic) ? "Must be above zero." : null);
  const n = draft.days.trim();
  const days =
    /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= ENABLE_PAID_MAX_DAYS ? null : `Between 1 and ${ENABLE_PAID_MAX_DAYS} days.`;
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

/**
 * The form's starting values: Light, or on a renewal the grant's own caps,
 * each never above Light (the grant's caps come from the API; a larger value
 * only by the person's own edit on this page). Never from the URL.
 */
export function initialDraft(state: Extract<EnablePaidState, { kind: "ready" }>): CapsDraft {
  if (!state.renewCaps) return { ...DEFAULT_CAPS };
  const lower = (a: string, b: string) => {
    const x = decimalOf(a);
    return x && x.lt(new Decimal(b)) ? x.toString() : b;
  };
  return {
    perCall: lower(state.renewCaps.perCall, DEFAULT_CAPS.perCall),
    perDay: lower(state.renewCaps.perDay, DEFAULT_CAPS.perDay),
    days: DEFAULT_CAPS.days,
  };
}

export type PageExpiry = { ok: true; validUntil: number; boundDays: number } | { ok: false; text: string };

export const CLOCK_SKEW_TEXT =
  "This computer's clock and Assay's differ by more than 2 minutes, so the expiry can't be checked. Set the clock right and reload.";

/**
 * The `validUntil` (unix seconds) this page shows and signs: `days` from this
 * device's clock, at most {@link ENABLE_PAID_MAX_DAYS}. The server's clock
 * (`GET /escrow`'s `serverTime`, carried forward from when it was read) only
 * checks it: more than {@link CLOCK_SKEW_LIMIT_SECONDS} apart, or unreadable,
 * and the page refuses, so a server answer can never move the expiry the
 * wallet signs away from the one on the page.
 */
export function pageExpiry(input: {
  localNowMs: number;
  serverTime: string | null | undefined;
  receivedAtMs: number;
  days: number;
}): PageExpiry {
  const server = input.serverTime ? Date.parse(input.serverTime) : Number.NaN;
  if (!Number.isFinite(server) || !input.receivedAtMs) return { ok: false, text: CLOCK_SKEW_TEXT };
  const serverNow = server + Math.max(0, input.localNowMs - input.receivedAtMs);
  if (Math.abs(serverNow - input.localNowMs) > CLOCK_SKEW_LIMIT_SECONDS * 1000) return { ok: false, text: CLOCK_SKEW_TEXT };
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > ENABLE_PAID_MAX_DAYS) {
    return { ok: false, text: `Between 1 and ${ENABLE_PAID_MAX_DAYS} days.` };
  }
  const now = Math.floor(input.localNowMs / 1000);
  const validUntil = now + input.days * 86_400;
  return { ok: true, validUntil, boundDays: Math.ceil((validUntil - now) / 86_400) };
}

/**
 * The chain RPC origins this page's `connect-src` allows: one list,
 * `src/config/strict-rpc-origins.json`, which `scripts/csp-policy.js` adds to
 * `CONNECT_ORIGINS`. Exact origins only. Add funds runs in place only when the
 * chain's RPC is one of them.
 */
export const STRICT_PAGE_RPC_ORIGINS: readonly string[] = strictRpcOrigins;

export function depositRunsHere(rpcUrl: string | null | undefined): boolean {
  if (!rpcUrl) return false;
  try {
    return STRICT_PAGE_RPC_ORIGINS.includes(new URL(rpcUrl).origin);
  } catch {
    return false;
  }
}

/** This page's own path, query and fragment: the `next` of a sign-in round trip. */
export function thisPageHref(win: Window = window): string {
  return `${win.location.pathname}${win.location.search}${win.location.hash}`;
}

/** Every item of a cursor-paged list, up to `maxPages` pages. */
export async function collectPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; pageInfo?: { nextCursor: string | null; hasMore: boolean } }>,
  maxPages = 20,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    const next = result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null;
    if (!next) break;
    cursor = next;
  }
  return items;
}

/** The two caps in atomic units, as `SetLimits` and `AuthorizeDelegate` carry them. */
export interface AtomicCapPair {
  maxVoucherAmount: string;
  maxPerWindow: string;
}

export type EnablePaidPlan =
  | {
      ok: true;
      /** The account ceiling `SetLimits` signs: the person's caps as the page shows them. */
      ceiling: AtomicCapPair;
      /** The grant's caps: the same values. */
      chosen: AtomicCapPair;
      /** The `validUntil` signed (unix seconds), at most `maxDays` from this device's clock. */
      expiry: { validUntil: number; maxDays: number };
      /** The same instant, as the page shows it. */
      validUntil: string;
      boundDays: number;
      nowSeconds: number;
    }
  | {
      ok: false;
      /** Why nothing can be signed; null when the caps are invalid (the form says why). */
      problem: string | null;
    };

/**
 * Everything the page signs, from what it shows: the caps parsed from the
 * form (the ceiling and the grant), and the expiry from this device's clock,
 * checked against the server's ({@link pageExpiry}). Nothing here is read from
 * the API but the server time, which can only refuse. The page builds its
 * wallet steps from this and nothing else (`enablePaidSteps`).
 */
export function enablePaidPlan(input: {
  parsed: ParsedEnablePaidCaps;
  serverTime: string | null | undefined;
  receivedAtMs: number;
  localNowMs: number;
}): EnablePaidPlan {
  const { parsed } = input;
  if (!parsed.ok) return { ok: false, problem: null };
  const expiry = pageExpiry({
    localNowMs: input.localNowMs,
    serverTime: input.serverTime,
    receivedAtMs: input.receivedAtMs,
    days: parsed.days,
  });
  if (!expiry.ok) return { ok: false, problem: expiry.text };
  const caps = { maxVoucherAmount: parsed.maxVoucherAmount, maxPerWindow: parsed.maxPerWindow };
  return {
    ok: true,
    ceiling: { ...caps },
    chosen: { ...caps },
    expiry: { validUntil: expiry.validUntil, maxDays: ENABLE_PAID_MAX_DAYS },
    validUntil: new Date(expiry.validUntil * 1000).toISOString(),
    boundDays: expiry.boundDays,
    nowSeconds: Math.floor(input.localNowMs / 1000),
  };
}

/** A credential id as it may appear in the way back: a plain id, nothing else. */
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The way back from the Funding page: `/agents/enable-paid?credential={id}`, never the key. */
export function enablePaidReturnHref(credentialId: string): string | null {
  return CREDENTIAL_ID.test(credentialId) ? `/agents/enable-paid?credential=${credentialId}` : null;
}

/**
 * Where the Funding page may send the person back to: exactly
 * `/agents/enable-paid?credential={id}`, a same-origin path. Any other path,
 * any other query parameter, a fragment (the key never travels in a URL the
 * page builds) or a malformed id: null. The page finds the key again from
 * this tab's own storage for that credential.
 */
export function enablePaidReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const next = safeNextPath(raw);
  if (next !== raw) return null;
  let url: URL;
  try {
    url = new URL(next, "https://assay.invalid");
  } catch {
    return null;
  }
  if (url.pathname !== "/agents/enable-paid" || url.hash || raw.includes("#")) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "credential") return null;
  const id = url.searchParams.get("credential") ?? "";
  const back = enablePaidReturnHref(id);
  return back === raw ? back : null;
}
