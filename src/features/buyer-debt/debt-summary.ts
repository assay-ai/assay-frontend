import Decimal from "decimal.js";

import type { Money } from "@/interfaces/api";
import type { BuyerDebt, BuyerDebts } from "@/interfaces/buyer-debt";
import { formatMoney, toDecimal } from "@/utils/money";

import { debtDate, debtStateOf, debtsToSign, splitDebts } from "./debt-copy";

/**
 * The short form of buyer debt, for the banner, the settle sheet and the
 * places that link to it (call rows, the receipt, Spend). The long sentences
 * in `debt-copy.ts` stay the source of truth for what each state means; this
 * file only says the same things in fewer words, and never drops an amount, a
 * date or the fact that paid calls are paused.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The sum of the debts' amounts, or `null` when they are in different assets
 * (one stablecoin today, so that is a future case: the screens then show the
 * count without a total rather than add apples to pears).
 */
export function debtTotal(debts: readonly Pick<BuyerDebt, "amount">[]): Money | null {
  if (debts.length === 0) return null;
  const { asset, decimals } = debts[0].amount;
  if (debts.some((debt) => debt.amount.asset !== asset || debt.amount.decimals !== decimals)) return null;
  const sum = debts.reduce((total, debt) => total.plus(toDecimal(debt.amount)), new Decimal(0));
  return { amount: sum.mul(new Decimal(10).pow(decimals)).toFixed(0), asset, decimals };
}

/** `$2.50`, or "N payments" when the debts cannot be added up. */
function totalText(debts: readonly Pick<BuyerDebt, "amount">[]): string {
  const total = debtTotal(debts);
  return total ? formatMoney(total, { decimals: 4 }) : plural(debts.length, "payment");
}

export type DebtBannerKind = "settle" | "other-wallet" | "collecting";

export interface DebtBannerSummary {
  kind: DebtBannerKind;
  /** One line: what is owed and what it stops. */
  title: string;
  /** One or two short sentences: the deadline or the write-off, and who else owes. */
  detail: string;
  /** The session wallet's own debts that still need a signature, oldest first. */
  toSign: BuyerDebt[];
  /** The button's label when there is something to sign. */
  actionLabel: string | null;
}

/**
 * The banner, in the buyer's words, from `GET /escrow/debts` — or `null` when
 * nothing is owed. Every listed debt pauses paid calls (the wire's rule), so
 * every title says so; free calls keep working and every detail says that too.
 */
export function debtBannerSummary(data: BuyerDebts | null | undefined): DebtBannerSummary | null {
  const { own, others } = splitDebts(data);
  const all = [...own, ...others];
  if (all.length === 0) return null;
  const toSign = debtsToSign(own);
  const othersToSign = debtsToSign(others);
  const collecting = all.filter((debt) => debtStateOf(debt) === "REPLACING");

  const extra: string[] = [];
  if (collecting.length > 0 && collecting.length < all.length) {
    extra.push(`${plural(collecting.length, "more payment")} you signed ${collecting.length === 1 ? "is" : "are"} being collected.`);
  }
  if (othersToSign.length > 0 && toSign.length > 0) {
    extra.push(
      `${plural(othersToSign.length, "more call")} (${totalText(othersToSign)}) ${othersToSign.length === 1 ? "is" : "are"} owed by another wallet of your organization: sign in with it to settle.`,
    );
  }

  if (toSign.length > 0) {
    const writtenOff = toSign.filter((debt) => debtStateOf(debt) === "WRITTEN_OFF");
    const open = toSign.filter((debt) => debtStateOf(debt) === "OPEN");
    const when: string[] = [];
    if (open.length > 0) {
      const earliest = open.reduce((first, debt) => (debt.writeOffAt < first.writeOffAt ? debt : first));
      when.push(
        `Settle by ${debtDate(earliest.writeOffAt)}, or the provider${open.length === 1 ? " is" : "s are"} not paid (paid calls stay paused either way).`,
      );
    }
    if (writtenOff.length > 0) {
      when.push(
        writtenOff.length === toSign.length && writtenOff.length === 1
          ? `Written off on ${debtDate(writtenOff[0].writeOffAt)}: the provider was not paid, and settling pays them.`
          : `${writtenOff.length} ${writtenOff.length === 1 ? "was" : "were"} written off: settling pays ${writtenOff.length === 1 ? "that provider" : "those providers"}.`,
      );
    }
    return {
      kind: "settle",
      title: `You owe ${totalText(toSign)} for ${plural(toSign.length, "call")}. Paid calls are paused until you settle.`,
      detail: [...when, ...extra, "Free calls still work."].join(" "),
      toSign,
      actionLabel: `Settle ${totalText(toSign)}`,
    };
  }

  if (othersToSign.length > 0) {
    return {
      kind: "other-wallet",
      title: `Your organization owes ${totalText(othersToSign)} for ${plural(othersToSign.length, "call")}. Paid calls are paused until it is settled.`,
      detail: [
        `Another wallet of your organization owes ${othersToSign.length === 1 ? "it" : "them"}: sign in with that wallet to settle.`,
        ...extra.filter((line) => !line.includes("another wallet")),
        "Free calls still work.",
      ].join(" "),
      toSign: [],
      actionLabel: null,
    };
  }

  return {
    kind: "collecting",
    title: `Collecting ${totalText(collecting)} you signed. Paid calls resume in about a minute.`,
    detail: "Nothing to do: it is collected from your escrow, then paid calls resume. Free calls still work.",
    toSign: [],
    actionLabel: null,
  };
}

/** Where one call's debt stands for this session, for a row or a receipt. */
export type OwedCallState =
  /** The session wallet can sign it now. */
  | { kind: "settle"; debt: BuyerDebt }
  /** Signed, being collected: nothing to do. */
  | { kind: "collecting"; debt: BuyerDebt }
  /** Another wallet of the organization owes it. */
  | { kind: "other-wallet"; debt: BuyerDebt }
  /** Not in the debts list (settled since, or the list could not be read). */
  | { kind: "unknown" };

export function owedCallState(data: BuyerDebts | null | undefined, intentId: string): OwedCallState {
  const { own, others } = splitDebts(data);
  const mine = own.find((debt) => debt.intentId === intentId);
  if (mine) return debtStateOf(mine) === "REPLACING" ? { kind: "collecting", debt: mine } : { kind: "settle", debt: mine };
  const theirs = others.find((debt) => debt.intentId === intentId);
  if (theirs) return debtStateOf(theirs) === "REPLACING" ? { kind: "collecting", debt: theirs } : { kind: "other-wallet", debt: theirs };
  return { kind: "unknown" };
}

/**
 * The escrow balance once the signed payments are collected: today's balance
 * less what is settled. `null` when either side is unknown or in another asset.
 */
export function balanceAfterSettling(balance: Money | null | undefined, settled: readonly Pick<BuyerDebt, "amount">[]): Money | null {
  const total = debtTotal(settled);
  if (!balance || !total || balance.asset !== total.asset || balance.decimals !== total.decimals) return null;
  const after = toDecimal(balance).minus(toDecimal(total));
  const floored = after.isNegative() ? new Decimal(0) : after;
  return { amount: floored.mul(new Decimal(10).pow(balance.decimals)).toFixed(0), asset: balance.asset, decimals: balance.decimals };
}

/**
 * Whether paid calls resume once these debts are collected: only when no
 * other debt is left, the organization's other wallets' included.
 */
export function resumesAfterSettling(data: BuyerDebts | null | undefined, settling: readonly Pick<BuyerDebt, "intentId">[]): boolean {
  const ids = new Set(settling.map((debt) => debt.intentId));
  const { own, others } = splitDebts(data);
  return [...own, ...others].every((debt) => ids.has(debt.intentId) || debtStateOf(debt) === "REPLACING");
}
