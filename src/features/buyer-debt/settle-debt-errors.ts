import { WalletNotReady } from "@/features/buyer-money/money-errors";
import { ApiError } from "@/libs/ApiClient";

import { settleDebtErrorSentence } from "./debt-copy";
import { DEBT_SIGNING_REFUSED } from "./settle-debt";

/**
 * One sentence for a failed settle, for the sheet's failure line (the raw
 * message stays under its Details). A declined wallet prompt never gets here:
 * the sheet says "Nothing was sent" for that itself.
 */
export function settleDebtFailure(error: unknown): string {
  if (error instanceof WalletNotReady) return error.message;
  if (error instanceof ApiError) return settleDebtErrorSentence(error) ?? error.message;
  if (error instanceof Error && error.message.startsWith(DEBT_SIGNING_REFUSED)) {
    return "The payment Assay prepared did not match this call exactly, so your wallet was not asked and nothing was signed. Try again; if it repeats, contact support.";
  }
  return "That did not go through. Nothing was signed. You can try again.";
}

/** Refusals after which the debts list is out of date: settled already, or signed and being collected. */
export function refreshesDebts(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "PAYMENT_DEBT_NOT_FOUND" || error.code === "PAYMENT_DEBT_REPLACEMENT_PENDING")
  );
}
