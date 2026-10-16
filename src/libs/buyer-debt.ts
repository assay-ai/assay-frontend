import type { DebtOutstandingContext } from "@/interfaces/buyer-debt";
import {
  PAYMENT_DEBT_NOT_FOUND,
  PAYMENT_DEBT_OUTSTANDING,
  PAYMENT_DEBT_REPLACEMENT_PENDING,
} from "@/interfaces/buyer-debt";

/**
 * The buyer-debt refusals in plain words, for `ApiClient` to put on the error
 * (the code, status and context are kept; only the sentence changes) and for
 * any screen that reads the context. See `features/buyer-debt`.
 */

interface ErrorLike {
  code?: string;
  status?: number;
  context?: Readonly<Record<string, unknown>>;
}

/** The context of a `PAYMENT_DEBT_OUTSTANDING` refusal, or `null` for any other error. */
export function debtOutstandingContext(error: unknown): DebtOutstandingContext | null {
  const err = error as ErrorLike | null | undefined;
  if (err?.code !== PAYMENT_DEBT_OUTSTANDING) return null;
  const ctx = err.context ?? {};
  return {
    count: typeof ctx.count === "number" ? ctx.count : 0,
    owed: typeof ctx.owed === "string" ? ctx.owed : null,
    debts: Array.isArray(ctx.debts) ? (ctx.debts as DebtOutstandingContext["debts"]) : [],
    settleWith: typeof ctx.settleWith === "string" ? ctx.settleWith : "",
  };
}

/**
 * The plain sentence for the debt error codes, or `null` for any other.
 * `PAYMENT_DEBT_OUTSTANDING` is what a paid call gets while any debt is left —
 * open, being collected, or written off.
 */
export function debtRefusalSentence(error: unknown): string | null {
  const err = error as ErrorLike | null | undefined;
  if (err?.code === PAYMENT_DEBT_NOT_FOUND) {
    return (
      "This session cannot settle this call: it was settled already, it is owed by another wallet " +
      "(sign in with that wallet), or it is another agent's call (settle it with the payer wallet)."
    );
  }
  if (err?.code === PAYMENT_DEBT_REPLACEMENT_PENDING) {
    return (
      "This call is signed already and its payment is being collected from your escrow (about a minute). " +
      "Nothing to sign; paid calls resume once it is collected."
    );
  }
  const ctx = debtOutstandingContext(error);
  if (!ctx) return null;
  const count = ctx.count || ctx.debts.length;
  const what = count === 1 ? "a call" : `${count} calls`;
  return (
    `Paid calls are paused: your escrow owes for ${what} your agent already made` +
    `${ctx.owed ? ` (${ctx.owed})` : ""}. Settle it from the banner at the top of the console. ` +
    "Free calls still work, and nothing was charged for this one."
  );
}

/** The voucher's window on the chain is full: the escrow's or the agent key's spending cap. */
const WINDOW_LIMIT_CODES: ReadonlySet<string> = new Set([
  "PAYMENT_VOUCHER_ESCROW_LIMIT_EXCEEDED",
  "PAYMENT_VOUCHER_DELEGATE_LIMIT_EXCEEDED",
]);

/**
 * Why settling a debt from the banner was refused, in plain words, or `null`
 * to keep the error's own message. Only for the two settle routes
 * (`/escrow/debts/:id/voucher-intent` and `/voucher`): the same codes mean
 * other things on an agent's own calls, so `ApiClient` does not reword them.
 */
export function settleDebtErrorSentence(error: unknown): string | null {
  const err = error as ErrorLike | null | undefined;
  const debtText = debtRefusalSentence(error);
  if (debtText && err?.code !== PAYMENT_DEBT_OUTSTANDING) return debtText;
  const code = err?.code ?? "";
  if (code === "PAYMENT_NEXT_SEQ_RATE_LIMITED") {
    return "Too many signing attempts in a short time. Wait a minute and try again. Nothing was signed.";
  }
  if (code === "PAYMENT_VOUCHER_ADMISSION_PAUSED") {
    const retry = err?.context?.retryAfter;
    return (
      "Payments are paused for a moment while a change to your payment limits lands on chain" +
      `${typeof retry === "number" && retry > 0 ? ` (about ${retry} s)` : ""}. Try again shortly. Nothing was charged.`
    );
  }
  if (WINDOW_LIMIT_CODES.has(code)) {
    return (
      "Your spending limit for the period is used up, so this payment cannot be accepted yet. " +
      "Try again once the period rolls over, or raise the limit. Nothing was charged."
    );
  }
  if (code.startsWith("PAYMENT_VOUCHER_SEQ_")) {
    return "Another payment took this voucher's number first. Sign to settle again: a new voucher is prepared.";
  }
  if (code === "LEDGER_INSUFFICIENT_AVAILABLE_BALANCE") {
    return "Your escrow does not hold enough to pay this call any more. Fund it, then sign to settle again.";
  }
  if (code === "PAYMENT_VOUCHER_BINDING_MISMATCH" && err?.context?.field === "resource") {
    return (
      "The tool this call used no longer exists, so the console cannot rebuild its voucher. " +
      "Your agent can settle it through the API, naming the tool's resource."
    );
  }
  return null;
}
