import { WalletNotReady } from "@/features/buyer-money/money-errors";
import {
  PAYMENT_DEBT_NOT_FOUND,
  PAYMENT_DEBT_NOT_YET_REPLACEABLE,
  PAYMENT_DEBT_REPLACEMENT_PENDING,
  PAYMENT_DEBT_REPLACEMENT_REFUSED,
} from "@/interfaces/buyer-debt";
import { ApiError } from "@/libs/ApiClient";
import { formatClock } from "@/libs/utc-time";

import { debtDeadline, settleDebtErrorSentence } from "./debt-copy";
import { DEBT_SIGNING_REFUSED } from "./settle-debt";

/**
 * One sentence for a failed settle, for the sheet's failure line (the raw
 * message stays under its Details). A declined wallet prompt never gets here:
 * the sheet says "Nothing was sent" for that itself.
 */
export function settleDebtFailure(error: unknown, now: number = Date.now()): string {
  if (error instanceof WalletNotReady) return error.message;
  const refusal = notYetRefusal(error, now);
  if (refusal) return notYetRefusalSentence(refusal, now);
  if (error instanceof ApiError) return settleDebtErrorSentence(error) ?? error.message;
  if (error instanceof Error && error.message.startsWith(DEBT_SIGNING_REFUSED)) {
    return "The payment Assay prepared did not match this call exactly, so your wallet was not asked and nothing was signed. Try again; if it repeats, contact support.";
  }
  return "That did not go through. Nothing was signed. You can try again.";
}

/**
 * Refusals after which the debts list is out of date: settled already, signed
 * and being collected, not replaceable yet (the list carries `replaceableAt`),
 * or changed while signing.
 */
const REFRESHING_CODES: ReadonlySet<string> = new Set([
  PAYMENT_DEBT_NOT_FOUND,
  PAYMENT_DEBT_REPLACEMENT_PENDING,
  PAYMENT_DEBT_NOT_YET_REPLACEABLE,
  PAYMENT_DEBT_REPLACEMENT_REFUSED,
]);

export function refreshesDebts(error: unknown): boolean {
  return error instanceof ApiError && REFRESHING_CODES.has(error.code);
}

/**
 * After a `PAYMENT_DEBT_NOT_YET_REPLACEABLE` refusal the sign button waits
 * this long at least: the browser's clock decides when a debt reads as ready,
 * and one running ahead of Assay's would turn the button on too early again.
 */
export const NOT_YET_BACKOFF_MS = 30_000;

export interface NotYetRefusal {
  /** The server's `replaceableAt`, when the refusal carries one. */
  serverAt: string | null;
  /** When to offer signing again: the server's time, and never sooner than the back-off. */
  retryAt: number;
}

/** The refusal's times, or `null` when it is not `PAYMENT_DEBT_NOT_YET_REPLACEABLE`. */
export function notYetRefusal(error: unknown, now: number): NotYetRefusal | null {
  if (!(error instanceof ApiError) || error.code !== PAYMENT_DEBT_NOT_YET_REPLACEABLE) return null;
  const raw = error.context?.replaceableAt;
  const serverAt = typeof raw === "string" && !Number.isNaN(Date.parse(raw)) ? raw : null;
  const backoff = now + NOT_YET_BACKOFF_MS;
  return { serverAt, retryAt: serverAt ? Math.max(Date.parse(serverAt), backoff) : backoff };
}

/**
 * The refusal in plain words: the time Assay gave, a hint when that time has
 * passed on this device (its clock is ahead), and when Try again comes back
 * (to the second: the back-off is short).
 */
export function notYetRefusalSentence(refusal: NotYetRefusal, now: number): string {
  const { serverAt, retryAt } = refusal;
  const when = serverAt ? ` from ${debtDeadline(serverAt, { now })}` : "";
  const skew =
    serverAt && Date.parse(serverAt) <= now ? " Your device's clock looks ahead of Assay's, so the button turned on early." : "";
  const again = retryAt > now ? `You can try again from ${formatClock(retryAt, { seconds: true })} UTC.` : "You can try again now.";
  return (
    `Assay can accept this payment only${when || " a little later"}: the original payment must expire on chain first, ` +
    `so you never pay twice. Nothing was signed.${skew} ${again}`
  );
}
