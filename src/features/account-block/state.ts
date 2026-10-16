/**
 * @fileoverview
 * The blocked-account state the dashboard reacts to, outside React.
 *
 * Two facts, from two sources:
 *
 *  - **confirmed** — `GET /account/block-status` says `blocked: true`. The
 *    account itself (its organization, its wallet or its delegate key) is on
 *    the blocklist, and every write it makes is refused by the backend.
 *  - **refusal** — some request just came back `403 ACCOUNT_BLOCKED` or
 *    `403 AUTH_ORGANIZATION_SUSPENDED`. The second always means this
 *    account's own organization. The first may name another party to the
 *    request — a provider's payout wallet, say — so on its own it is not proof
 *    that *this* account is blocked, and the banner words it accordingly until
 *    the block status confirms it.
 *
 * Neither ever signs anyone out. See `ACCOUNT_BLOCKED_CODES` in `ApiClient`.
 *
 * A module store rather than React state because `ApiClient` — a module-level
 * singleton — feeds it from its interceptor and reads it in its write guard.
 */
import { ApiError } from "@/libs/ApiClient";
import type { AccountBlockStatus, AccountBlockStatusEntry } from "@/interfaces/account-block";

export interface BlockedRefusal {
  readonly code: string;
  readonly message: string;
}

interface Snapshot {
  readonly confirmed: boolean;
  readonly refusal: BlockedRefusal | null;
}

let snapshot: Snapshot = { confirmed: false, refusal: null };
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>): void {
  const merged = { ...snapshot, ...next };
  if (merged.confirmed === snapshot.confirmed && merged.refusal === snapshot.refusal) return;
  snapshot = merged;
  for (const listener of listeners) listener();
}

export function subscribeAccountBlock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccountBlockSnapshot(): Snapshot {
  return snapshot;
}

/** The server-render snapshot: nothing known, nothing blocked. */
const SERVER_SNAPSHOT: Snapshot = Object.freeze({ confirmed: false, refusal: null });
export function getServerAccountBlockSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

/** Fed from the block-status query. */
export function setAccountBlockConfirmed(confirmed: boolean): void {
  set({ confirmed });
}

/** When the latest refusal arrived (`Date.now()`), kept out of the snapshot. */
let refusalAt = 0;

/** Fed from `ApiClient`'s interceptor, for every blocked refusal. */
export function reportBlockedRefusal(error: Pick<ApiError, "code" | "message">): void {
  refusalAt = Date.now();
  const current = snapshot.refusal;
  if (current && current.code === error.code && current.message === error.message) return;
  set({ refusal: { code: error.code, message: error.message } });
}

export function dismissBlockedRefusal(): void {
  set({ refusal: null });
}

/** On sign-out or an identity switch: whose block it was is part of who was signed in. */
export function resetAccountBlock(): void {
  set({ confirmed: false, refusal: null });
}

/**
 * Fed from each block-status answer, with the time its request was SENT, so
 * that an answer already on its way when a refusal arrived cannot clear it.
 *
 * A fresh `blocked: false` clears the refusal when that refusal was about this
 * account: an `AUTH_ORGANIZATION_SUSPENDED` (always this account's own
 * organization), or any refusal while the block was confirmed — the block was
 * lifted, so the banner goes without a reload. Another party's
 * `ACCOUNT_BLOCKED`, on an account that was never blocked, stays until it is
 * dismissed. A later refusal sets the state again.
 */
export function settleBlockStatus(blocked: boolean, requestedAt: number): void {
  if (blocked) return;
  const { refusal, confirmed } = snapshot;
  if (!refusal || requestedAt < refusalAt) return;
  if (confirmed || refusal.code === "AUTH_ORGANIZATION_SUSPENDED") set({ refusal: null });
}

/**
 * Whether a session exists to ask the block status for — the same rule
 * `ApiClient` uses to attach auth: Privy's token once it is ready and signed
 * in, else the token stored in `localStorage` (token-based sessions, where
 * Privy may never become ready). Neither: a signed-out visitor, and the
 * request is never sent — it would 401, and a 401 signs out.
 */
export function hasBlockStatusSession(session: {
  readonly ready: boolean;
  readonly authenticated: boolean;
  readonly hasStoredToken: boolean;
}): boolean {
  return (session.ready && session.authenticated) || session.hasStoredToken;
}

/**
 * Paths a blocked person may still write to. `POST /auth/wallet/link` links
 * the Privy wallet at sign-in; the backend lets it through because it moves
 * nothing, and refusing it here would break sign-in for a blocked person.
 */
const WRITE_ALLOWED_PREFIXES: readonly string[] = ["/auth/"];

/**
 * `POST`s that only read, matched exactly. The backend marks the same routes
 * read-only (`@BlockedSessionReadOnly`) and lets a blocked session through.
 * `POST /providers/me/slash-requests/lookup` is a POST only for its body: the
 * penalties page uses it to match on-chain penalties to Assay cases, which a
 * blocked provider needs most. `POST /providers/me/slash-requests/dispute-intent`
 * only builds an unsigned transaction: the chain lets a blocked provider
 * dispute a penalty, and so does the backend. The revoke writes a blocked
 * account may still make are in `ALLOWED_WHILE_BLOCKED` below.
 */
const READ_ONLY_POSTS: ReadonlySet<string> = new Set([
  "/providers/me/slash-requests/lookup",
  "/providers/me/slash-requests/dispute-intent",
]);

/**
 * Writes a blocked person must still be able to make, matched on method and
 * the exact route shape. The backend marks the same routes `@AllowedWhileBlocked`
 * (`shared/auth/blocked-session-read-only.decorator.ts`): they write, but only
 * to take authority AWAY from the account — revoking an escrow delegate and
 * revoking an agent credential — so a leaked delegate or credential cannot
 * come back to life on unblock.
 */
const ALLOWED_WHILE_BLOCKED: readonly { readonly method: string; readonly path: RegExp }[] = [
  { method: "POST", path: /^\/escrow\/delegates\/revoke-intent$/ },
  { method: "POST", path: /^\/escrow\/delegates\/revoke$/ },
  { method: "DELETE", path: /^\/agents\/[^/]+\/credentials\/[^/]+$/ },
];

export const BLOCKED_WRITE_MESSAGE =
  "Your account is blocked by Assay. You can view your data, but you cannot make payments or changes. Contact Assay support.";

/**
 * The client-side write guard `ApiClient` consults. Refuses a write only once
 * the block is CONFIRMED by the block status — a refusal that may be about
 * another party must not lock this account out of everything else.
 */
export function blockedWriteGuard(
  confirmed: boolean,
  method: string,
  url: string,
): ApiError | null {
  if (!confirmed) return null;
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") return null;
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/api\/v\d+/, "");
  if (WRITE_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  const route = path.split("?")[0];
  if (upper === "POST" && READ_ONLY_POSTS.has(route)) return null;
  if (ALLOWED_WHILE_BLOCKED.some((allowed) => allowed.method === upper && allowed.path.test(route))) return null;
  return new ApiError("ACCOUNT_BLOCKED", BLOCKED_WRITE_MESSAGE, 403, url);
}

export type BlockBannerState =
  | { readonly kind: "none" }
  /** This account is blocked. Persistent: it cannot be dismissed. */
  | { readonly kind: "blocked"; readonly blocks: readonly AccountBlockStatusEntry[] }
  /** A request was refused because some account in it is blocked, maybe not this one. */
  | { readonly kind: "refused"; readonly refusal: BlockedRefusal };

/**
 * What the banner says, from the block status and the latest refusal.
 *
 * `AUTH_ORGANIZATION_SUSPENDED` is always this account's own organization, so
 * it reads as blocked even before the status confirms it.
 */
export function bannerStateFor(
  status: AccountBlockStatus | undefined,
  refusal: BlockedRefusal | null,
): BlockBannerState {
  if (status?.blocked) return { kind: "blocked", blocks: status.blocks ?? [] };
  if (!refusal) return { kind: "none" };
  if (refusal.code === "AUTH_ORGANIZATION_SUSPENDED") return { kind: "blocked", blocks: [] };
  return { kind: "refused", refusal };
}

const ROLE_LABEL: Record<string, string> = {
  ORGANIZATION: "your organization",
  PAYER: "your wallet",
  DELEGATE: "your delegate key",
};

/** `LEAKED_KEY` → `leaked key`. */
function reasonLabel(reasonCode: string): string {
  return reasonCode.toLowerCase().replace(/_/g, " ");
}

/** One line per block: what is blocked, since when, and the short reason. */
export function blockSummary(entry: AccountBlockStatusEntry, locale?: string): string {
  const what = ROLE_LABEL[entry.role] ?? "this account";
  const when = new Date(entry.blockedAt);
  const date = Number.isNaN(when.getTime())
    ? entry.blockedAt
    : when.toLocaleDateString(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
  return `${what[0].toUpperCase()}${what.slice(1)} is blocked since ${date} (reason: ${reasonLabel(entry.reasonCode)}).`;
}
