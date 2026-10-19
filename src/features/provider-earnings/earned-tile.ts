import Decimal from "decimal.js";

import type { Money, ProviderEarningsFigures } from "@/interfaces";

import { notCreditedBreakdown, settlementShown } from "./not-credited";

export const EARNED_IN_WALLET = "already in your wallet — paid at each redemption";

const calls = (count: number) => `${count} call${count === 1 ? "" : "s"}`;

function nonZero(value: Money | null | undefined, count: number | undefined): value is Money {
  return Boolean(value) && (count ?? 0) > 0 && !new Decimal(value!.amount).isZero();
}

/**
 * The "Earned this month" tile's sub-line.
 *
 * `earned` counts only calls paid out of the buyer's escrow, and every one of
 * them was paid to the provider's wallet at redemption: the platform never
 * credits or owes a provider anything from its own funds. So the whole figure
 * is in the wallet. What may still come is an open buyer debt, which the tile
 * names beside it so a provider does not read it as lost — or as owed by us.
 */
export function earnedTileSub(
  totals: ProviderEarningsFigures | null | undefined,
  format: (value: Money) => string,
): string {
  const debt = totals?.debtOutstanding;
  const count = totals?.debtOutstandingCalls ?? 0;
  if (!nonZero(debt, count)) return EARNED_IN_WALLET;
  return `${EARNED_IN_WALLET} · ${format(debt)} more for ${calls(count)} is waiting on buyers`;
}

/** One way a call that passed paid the provider nothing (yet). */
export interface UnpaidLine {
  readonly key: "debtOutstanding" | "uncollected" | "forfeited";
  /** The call class of the per-call export these calls carry, for the drill-down. */
  readonly className: "PAID_BUYER_DEBT" | "PAID_UNCOLLECTED" | "PROVIDER_FORFEITED";
  readonly label: string;
  readonly amount: Money;
  readonly calls: number;
  /** The plain-words explanation, said to the provider. */
  readonly explanation: string;
  /** Why, in one short sentence (no amount: the row shows it). */
  readonly reason: string;
  /** What the provider can do about it, in one short sentence. */
  readonly action: string;
  /** Whether the provider can act on it (forfeits: keep the stake up) or not (the buyer's debt). */
  readonly actionable: boolean;
}

/** The short reason and the provider's next step, per class. Deadlines stay in the words. */
export const UNPAID_COPY: Record<UnpaidLine["key"], { reason: string; action: string; actionable: boolean }> = {
  debtOutstanding: {
    reason: "Passed our checks, but the buyer's payment did not go through yet. The money is still in their escrow.",
    action: "Nothing to do: it is the buyer's debt. Paid to you when they settle. After 30 days it shows as overdue.",
    actionable: false,
  },
  // Every `uncollected` row is a 30-day overdue debt.
  uncollected: {
    reason: "Overdue: the buyer has not paid for 30 days. They are blocked from paid calls until they do.",
    action: "Nothing to do. You will be paid when the buyer pays.",
    actionable: false,
  },
  forfeited: {
    reason: "Not collected because of your account: your stake was below the minimum, or you were blocked. The buyer was not charged.",
    action: "Keep your stake above the minimum to avoid this.",
    actionable: true,
  },
};

/**
 * The calls that passed our checks but were not paid, in plain words — open
 * buyer debt, written-off (uncollected) calls, and forfeited calls. None of
 * them is in `earned`, and none of them is paid by the platform: a provider is
 * paid only from a buyer's escrow. Empty when every figure is zero or absent.
 */
export function unpaidLines(
  totals: ProviderEarningsFigures | null | undefined,
  format: (value: Money) => string,
): UnpaidLine[] {
  const lines: UnpaidLine[] = [];
  if (!totals) return lines;
  if (nonZero(totals.debtOutstanding, totals.debtOutstandingCalls)) {
    const n = totals.debtOutstandingCalls ?? 0;
    lines.push({
      key: "debtOutstanding",
      className: "PAID_BUYER_DEBT",
      ...UNPAID_COPY.debtOutstanding,
      label: "Waiting on the buyer",
      amount: totals.debtOutstanding,
      calls: n,
      explanation:
        `${format(totals.debtOutstanding)} for ${calls(n)} that passed our checks, but the ` +
        "buyer's payment could not be collected from their escrow. The money is still held " +
        "there; you are paid as soon as the buyer signs again. If they do not within 30 days, " +
        "it shows as overdue: the buyer still owes it, and you are paid when they settle. " +
        "The platform does not pay it in their place.",
    });
  }
  if (nonZero(totals.uncollected, totals.uncollectedCalls)) {
    const n = totals.uncollectedCalls ?? 0;
    lines.push({
      key: "uncollected",
      className: "PAID_UNCOLLECTED",
      ...UNPAID_COPY.uncollected,
      label: "Overdue",
      amount: totals.uncollected,
      calls: n,
      explanation:
        `${format(totals.uncollected)} for ${calls(n)} that passed our checks is overdue: the ` +
        "buyer has not paid for 30 days. You were not paid and no fee was taken. The buyer " +
        "still owes it and is blocked from paid calls until they pay; you will be paid then. " +
        "The platform does not pay it in their place.",
    });
  }
  if (nonZero(totals.forfeited, totals.forfeitedCalls)) {
    const n = totals.forfeitedCalls ?? 0;
    lines.push({
      key: "forfeited",
      className: "PROVIDER_FORFEITED",
      ...UNPAID_COPY.forfeited,
      label: "Forfeited by you",
      amount: totals.forfeited,
      calls: n,
      explanation:
        `${format(totals.forfeited)} for ${calls(n)} whose payment failed because of your ` +
        "account — your stake was below the minimum, or you were blocked. The buyer was not " +
        "charged and nobody was paid.",
    });
  }
  return lines;
}

export interface EarningsSplit {
  /**
   * What reached the wallet: all of `earned`, in whole cents. It and `fee` are
   * rounded once together (`settlementShown`), so Home, Money's split and its
   * Gross − fee = Net show the same cents (B13 review M4). A provider is paid only out of
   * the buyer's escrow, at each redemption, so nothing in `earned` is owed by
   * the platform or still to come.
   */
  inWallet: Money | null;
  /**
   * Open buyer debt: passed our checks, the buyer's payment is not collected
   * yet. Not in `earned`; paid once the buyer signs again — even after it is
   * overdue, since the buyer still owes it. Never shown as owed by the platform.
   */
  waitingOnBuyers: Money | null;
  waitingOnBuyersCalls: number;
  fee: Money | null;
  /** "Not credited": the sum of its reasons (`notCreditedBreakdown`), the same calls Money lists. */
  notCredited: Money | null;
  notCreditedCalls: number;
}

function positive(value: Money | null | undefined): Money | null {
  return value && new Decimal(value.amount || "0").gt(0) ? value : null;
}

/** The month's money as the provider reads it: in the wallet, Assay's fee, not credited. */
export function earningsSplit(totals: ProviderEarningsFigures | null | undefined): EarningsSplit {
  const waiting = positive(totals?.debtOutstanding);
  const notCredited = notCreditedBreakdown(totals);
  const shown = settlementShown(totals?.earned, positive(totals?.platformFee));
  return {
    inWallet: shown.net,
    waitingOnBuyers: waiting,
    waitingOnBuyersCalls: waiting ? (totals?.debtOutstandingCalls ?? 0) : 0,
    fee: shown.fee,
    notCredited: positive(notCredited.amount),
    notCreditedCalls: notCredited.calls,
  };
}

/** A line under the provider home's "This month": what passed but is not in the wallet, and where to look. */
export interface HomeUnpaidNote {
  readonly key: "debtOutstanding" | "uncollected" | "forfeited";
  readonly text: string;
  readonly tone: "neutral" | "warning";
  readonly link: { readonly label: string; readonly href: string };
}

/**
 * The provider home's short notes on passed-but-unpaid money. Open buyer debt
 * says the provider has nothing to do (it is the buyer's debt); written-off
 * (overdue) calls say the same, so Home names every line Money's
 * "Passed, but not paid" lists, in its order; forfeited calls are the
 * provider's to avoid, so they link to Stake.
 *
 * Forfeits are this month's, and the cause may be over: when the stake covers
 * the minimum now (`stakeEnough`), the note says it happened earlier and is
 * calm; it warns only while the stake is short or cannot be read.
 */
export function homeUnpaidNotes(
  totals: ProviderEarningsFigures | null | undefined,
  format: (value: Money) => string,
  hrefs: { money: string; stake: string },
  stakeEnough: boolean | null = null,
): HomeUnpaidNote[] {
  const notes: HomeUnpaidNote[] = [];
  if (!totals) return notes;
  if (nonZero(totals.debtOutstanding, totals.debtOutstandingCalls)) {
    const n = totals.debtOutstandingCalls ?? 0;
    notes.push({
      key: "debtOutstanding",
      text: `${format(totals.debtOutstanding)} for ${calls(n)} is waiting on buyers. It reaches your wallet when they settle; nothing for you to do.`,
      tone: "neutral",
      link: { label: "Details", href: hrefs.money },
    });
  }
  if (nonZero(totals.uncollected, totals.uncollectedCalls)) {
    const n = totals.uncollectedCalls ?? 0;
    notes.push({
      key: "uncollected",
      text: `${format(totals.uncollected)} for ${calls(n)} is overdue: the buyer has not paid for 30 days. They are blocked from paid calls until they do; you will be paid then.`,
      tone: "neutral",
      link: { label: "Details", href: hrefs.money },
    });
  }
  if (nonZero(totals.forfeited, totals.forfeitedCalls)) {
    const n = totals.forfeitedCalls ?? 0;
    notes.push(
      stakeEnough === true
        ? {
            key: "forfeited",
            text:
              `${format(totals.forfeited)} for ${calls(n)} was forfeited earlier this month, while your stake was below ` +
              "the minimum or you were blocked. Your stake covers the minimum now.",
            tone: "neutral",
            link: { label: "Details", href: hrefs.money },
          }
        : {
            key: "forfeited",
            text: `${format(totals.forfeited)} for ${calls(n)} was forfeited this month: your stake was below the minimum, or you were blocked.`,
            tone: "warning",
            link: { label: "Check your stake", href: hrefs.stake },
          },
    );
  }
  return notes;
}

/** The per-call rows of one class, newest first, for a drill-down: the first `limit`, and how many more. */
export function callsOfClass<T extends { classification: string; createdAt: string }>(
  rows: readonly T[],
  className: string,
  limit = 10,
): { items: T[]; total: number; more: number } {
  const matching = rows
    .filter((row) => row.classification === className)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const items = matching.slice(0, limit);
  return { items, total: matching.length, more: matching.length - items.length };
}
