import type { OperatorChallenge, OperatorSignIn } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { saveOperatorSession, type OperatorSessionEnd } from "@/libs/operator-session";

/**
 * The operator wallet sign-in, without React or a wallet SDK in it so it can
 * be tested with a mocked wallet.
 *
 *  1. `POST /operator/auth/challenge { address }` → an EIP-4361 message.
 *  2. The wallet `personal_sign`s that message EXACTLY as returned. The
 *     backend refuses any message that is not byte-for-byte the one it issued.
 *  3. `POST /operator/auth/verify { message, signature }` → `{ token, expiresAt }`,
 *     stored under the operator's own key, never the buyer `accessToken`.
 */
export interface SignInDeps {
  readonly challenge: (address: string) => Promise<OperatorChallenge>;
  readonly sign: (message: string) => Promise<string>;
  readonly verify: (body: { message: string; signature: string }) => Promise<OperatorSignIn>;
}

export async function signInWithWallet(address: string, deps: SignInDeps): Promise<OperatorSignIn> {
  const { message } = await deps.challenge(address);
  const signature = await deps.sign(message);
  const session = await deps.verify({ message, signature });
  saveOperatorSession({ token: session.token, expiresAt: session.expiresAt });
  return session;
}

/** How long a session lasts by default (`OPERATOR_SESSION_TTL_HOURS`). */
export const SESSION_HOURS = 8;

export const NOT_AN_OPERATOR_MESSAGE = "This wallet is not an Assay operator.";

/** Is this the wallet closing or declining its prompt (EIP-1193 `4001`)? */
function isWalletRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === 4001 || code === "ACTION_REJECTED") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /user (rejected|denied|cancel)/i.test(message);
}

/** A sign-in failure in words the operator can act on, with the code kept. */
export function signInErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403 || error.code === "OPERATOR_NOT_AUTHORIZED") {
      return `${NOT_AN_OPERATOR_MESSAGE} It signed correctly, but it is not an active operator. Ask an operator administrator to add it.`;
    }
    if (error.status === 429 || error.code === "OPERATOR_AUTH_RATE_LIMITED") {
      return "Too many sign-in attempts. Wait five minutes, then try again.";
    }
    if (error.status === 401) {
      return "The signature was not accepted: the message may have expired or been changed. Try again.";
    }
    if (error.code === "NETWORK_ERROR" || error.status === 0) {
      return "The API could not be reached. Check your connection and try again.";
    }
    return `Sign-in failed: ${error.message} (${error.code})`;
  }
  if (isWalletRejection(error)) return "Nothing was signed: the wallet prompt was closed or declined.";
  if (error instanceof Error && error.message) return `The wallet did not sign: ${error.message}`;
  return "Sign-in failed. Try again.";
}

/** What the sign-in screen says about how the last session ended. */
export function sessionEndMessage(end: OperatorSessionEnd | null): string | null {
  switch (end) {
    case "expired":
      return "Your operator session ended (it expired or was revoked). Sign in again.";
    case "refused":
      return "Your operator session was refused. Sign in again.";
    default:
      return null;
  }
}

/** Milliseconds until the session expires, clamped to what `setTimeout` takes. */
export function msUntilExpiry(expiresAt: string, now: number = Date.now()): number {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 0;
  return Math.min(Math.max(at - now, 0), 2_147_483_647);
}

/** The 403 that means "signed correctly, but not an active operator". */
export function isNotAnOperator(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "OPERATOR_NOT_AUTHORIZED" || error.status === 403);
}

/**
 * "Sign in with Privy": what to do next with the user's Privy embedded EVM
 * wallet. Pure, so the one-click flow can be tested without Privy.
 *
 *  - `login`: not signed in with Privy yet; open Privy's own modal.
 *  - `wait`: Privy is still loading, or the embedded wallet exists on the
 *    account but has not reached the wallet list yet.
 *  - `create`: signed in, and the account has no embedded EVM wallet (someone
 *    who logged in with an external wallet). Created the way the app does on
 *    login (`createOnLogin: "users-without-wallets"`), with `createWallet()`.
 *  - `sign`: sign the challenge with this wallet.
 */
export type PrivyWalletStep<W> =
  | { readonly step: "login" }
  | { readonly step: "wait" }
  | { readonly step: "create" }
  | { readonly step: "sign"; readonly wallet: W };

export function privyWalletStep<W extends { walletClientType: string; address: string }>(input: {
  readonly ready: boolean;
  readonly authenticated: boolean;
  readonly walletsReady: boolean;
  readonly wallets: readonly W[];
  /** The Privy account lists an embedded EVM wallet (`linkedAccounts`). */
  readonly accountHasEmbeddedWallet: boolean;
}): PrivyWalletStep<W> {
  if (!input.ready) return { step: "wait" };
  if (!input.authenticated) return { step: "login" };
  const embedded = input.wallets.find((wallet) => wallet.walletClientType === "privy");
  if (embedded) return { step: "sign", wallet: embedded };
  if (!input.walletsReady || input.accountHasEmbeddedWallet) return { step: "wait" };
  return { step: "create" };
}

/**
 * Operator sign-out. Ends the operator session only: the Privy login, and the
 * buyer or provider session that goes with it, are not touched.
 */
export async function signOutOperator(deps: {
  readonly logout: () => Promise<void>;
  readonly clear: () => void;
}): Promise<void> {
  try {
    await deps.logout();
  } catch {
    /* the session is dropped here whatever the backend answered */
  }
  deps.clear();
}
