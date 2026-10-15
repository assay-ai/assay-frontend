import { isUnsettledRefusal } from "@/features/delegation/unsettled";
import { isRelayedRefusal, relayedRefusal } from "@/features/escrow/relayed-refusal";
import { EvmDepositRefused } from "@/features/funding/evm-deposit";
import { ApiError } from "@/libs/ApiClient";
import { knowsError, plainError } from "@/libs/plain-language";

/**
 * One sentence for a failed money action (deposit, caps, withdraw, claim,
 * pay permission). The raw message stays under SignAction's Details.
 */
const ESCROW_REFUSALS: Record<string, string> = {
  SETTLEMENT_WITHDRAWALS_FROZEN:
    "Withdrawals are paused for everyone while we check a reconciliation difference. Nothing was taken from your escrow. Try again later.",
  SETTLEMENT_WITHDRAWAL_NOT_YET_AVAILABLE:
    "There is nothing to claim yet: either no request is standing, or its wait has not finished.",
  PAYMENT_ESCROW_NOT_OPEN: "You have no escrow yet. Your first deposit opens it.",
  PAYMENT_ESCROW_BALANCE_UNAVAILABLE: "We could not read the chain just now. Nothing was signed. Try again in a moment.",
  CHAIN_PROGRAM_NOT_CONFIGURED: "This chain is not set up for escrow yet. Your money is untouched; this is ours to fix.",
  CHAIN_ACCOUNT_LAYOUT_UNEXPECTED:
    "We could not read your escrow correctly, so nothing was built. Your money is untouched; please contact support.",
  PAYMENT_DEPOSIT_EXPIRED: "The deposit took too long to sign and expired. Nothing was taken. Try again.",
  PAYMENT_DEPOSIT_ACCOUNT_NOT_LINKED: "This wallet is not linked to your account on that chain. Nothing was sent.",
};

/** A wallet problem the person can fix, thrown from a step before any prompt. Its message is shown as is. */
export class WalletNotReady extends Error {}

export function describeMoneyError(error: unknown): string {
  if (error instanceof WalletNotReady) return error.message;
  if (error instanceof EvmDepositRefused) return error.message;
  if (isUnsettledRefusal(error)) {
    return "Some payments are still being settled and these new limits would block them. Wait a minute and try again.";
  }
  if (isRelayedRefusal(error)) return relayedRefusal(error as ApiError).text;
  if (error instanceof ApiError) {
    if (ESCROW_REFUSALS[error.code]) return ESCROW_REFUSALS[error.code]!;
    return knowsError(error.code) ? plainError(error.code) : "That did not go through. Nothing was signed. Try again.";
  }
  return "That did not go through. You can try again.";
}
