import type { DebtOutstandingContext } from "@/interfaces/buyer-debt";
import { PAYMENT_DEBT_NOT_FOUND, PAYMENT_DEBT_OUTSTANDING } from "@/interfaces/buyer-debt";

/**
 * The buyer-debt refusals in plain words, for `ApiClient` to put on the error
 * (the code, status and context are kept; only the sentence changes) and for
 * any screen that reads the context. See `features/buyer-debt`.
 */

interface ErrorLike {
  code?: string;
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
 * The plain sentence for the two debt error codes, or `null` for any other.
 * `PAYMENT_DEBT_OUTSTANDING` is what a paid call gets while a debt is open.
 */
export function debtRefusalSentence(error: unknown): string | null {
  const err = error as ErrorLike | null | undefined;
  if (err?.code === PAYMENT_DEBT_NOT_FOUND) {
    return "This call is no longer owed: it was settled already, written off, or belongs to another wallet.";
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
