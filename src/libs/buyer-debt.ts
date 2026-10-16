import type { DebtOutstandingContext } from "@/interfaces/buyer-debt";
import {
  PAYMENT_DEBT_NOT_FOUND,
  PAYMENT_DEBT_NOT_YET_REPLACEABLE,
  PAYMENT_DEBT_OUTSTANDING,
  PAYMENT_DEBT_REPLACEMENT_PENDING,
  PAYMENT_DEBT_REPLACEMENT_REFUSED,
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

/** `17 Oct, 14:05`, in the viewer's own time zone; the text unchanged when it is not a time. */
export function debtLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Why a debt cannot be settled yet, with the time it can. */
export function notYetReplaceableSentence(
  replaceableAt: string | null | undefined,
  subject: "this" | "it" | "the first" = "this",
): string {
  const from = replaceableAt ? `from ${debtLocalTime(replaceableAt)}` : "in a few minutes";
  const you = subject === "this" ? "You" : "you";
  return (
    `${you} can settle ${subject} ${from} (the original payment must expire on chain first, ` +
    "so you never pay twice)."
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
  if (code === PAYMENT_DEBT_NOT_YET_REPLACEABLE) {
    const at = err?.context?.replaceableAt;
    return `${notYetReplaceableSentence(typeof at === "string" ? at : null)} Nothing was signed.`;
  }
  if (code === PAYMENT_DEBT_REPLACEMENT_REFUSED) {
    return "This call changed while you were signing, so the payment was not accepted and nothing was charged. Try again.";
  }
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
