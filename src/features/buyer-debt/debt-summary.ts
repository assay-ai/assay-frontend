import Decimal from "decimal.js";

import type { Money } from "@/interfaces/api";
import type { BuyerDebt, BuyerDebts, CallDebt } from "@/interfaces/buyer-debt";
import { formatMoney, toDecimal } from "@/utils/money";

import { debtDeadline, debtStateOf, debtsToSign, splitDebts } from "./debt-copy";

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
        `Settle by ${debtDeadline(earliest.writeOffAt)}, or the provider${open.length === 1 ? " is" : "s are"} not paid (paid calls stay paused either way).`,
      );
    }
    if (writtenOff.length > 0) {
      when.push(
        writtenOff.length === toSign.length && writtenOff.length === 1
          ? `Written off on ${debtDeadline(writtenOff[0].writeOffAt)}: the provider was not paid, and settling pays them.`
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

function moneyOf(value: Decimal, like: Money): Money {
  return { amount: value.mul(new Decimal(10).pow(like.decimals)).toFixed(0), asset: like.asset, decimals: like.decimals };
}

/**
 * The escrow balance once the signed payments are collected: today's balance
 * less what is settled. Never floored: a balance that would go below zero is
 * a shortfall, and `settleReadiness` blocks signing for it (review 2026-10-17
 * P1-3). `null` when either side is unknown or in another asset.
 */
export function balanceAfterSettling(
  balance: Money | null | undefined,
  settled: readonly Pick<BuyerDebt, "amount">[],
): { after: Money; shortBy: null } | { after: null; shortBy: Money } | null {
  const total = debtTotal(settled);
  if (!balance || !total || balance.asset !== total.asset || balance.decimals !== total.decimals) return null;
  const after = toDecimal(balance).minus(toDecimal(total));
  return after.lt(0)
    ? { after: null, shortBy: moneyOf(after.negated(), balance) }
    : { after: moneyOf(after, balance), shortBy: null };
}

/** What stops a settlement from being collected, and the one step that fixes it. */
export interface SettleBlock {
  kind: "funds" | "per-call" | "window";
  /** One plain sentence with the exact amounts. */
  text: string;
  /** The way out: a button label and where it goes. */
  action: { label: string; href: string };
}

export interface SettleEscrowReading {
  chainReadable?: boolean;
  balance: Money | null;
  spendable: Money | null;
  maxVoucherAmount: Money | null;
  maxPerWindow: Money | null;
  spentInWindow: Money | null;
  windowStartedAt: string | null;
  windowSeconds: number;
}

const FUNDING_DEPOSIT = "/funding?action=deposit";
const FUNDING_CAPS = "/funding?action=caps";

/**
 * Whether the escrow can pay these debts once they are signed, checked before
 * the wallet opens: a signature the redemption then cannot collect only puts
 * the debt back to OPEN, minutes later (review 2026-10-17 P1-3).
 *
 * - Funds: an OPEN debt's hold is still counted in `openHolds`, so it can draw
 *   on `spendable` plus its own amount; a WRITTEN_OFF debt's hold was
 *   released, so it needs `spendable` alone.
 * - Per-call ceiling: each payment is one voucher, so each must fit
 *   `maxVoucherAmount` (the wallet signs as the payer, under the escrow's own
 *   caps, not an agent's).
 * - 24-hour ceiling: together they must fit what is left of `maxPerWindow`
 *   (a window that has ended counts as unspent).
 *
 * Empty when it all fits, or when the escrow could not be read (nothing to
 * check against; the sheet says so instead of guessing).
 */
export function settleReadiness(
  escrow: SettleEscrowReading | null | undefined,
  settling: readonly Pick<BuyerDebt, "amount" | "state">[],
  now: number = Date.now(),
): SettleBlock[] {
  const total = debtTotal(settling);
  if (!escrow || escrow.chainReadable === false || !total) return [];
  const blocks: SettleBlock[] = [];
  const fmt = (value: Decimal) => formatMoney(moneyOf(value, total), { decimals: 4 });
  const same = (money: Money | null): money is Money =>
    money !== null && money.asset === total.asset && money.decimals === total.decimals;

  const free = same(escrow.spendable) ? escrow.spendable : same(escrow.balance) ? escrow.balance : null;
  if (free) {
    const ownHolds = settling
      .filter((debt) => debtStateOf(debt) === "OPEN")
      .reduce((sum, debt) => sum.plus(toDecimal(debt.amount)), new Decimal(0));
    const available = same(escrow.spendable) ? toDecimal(free).plus(ownHolds) : toDecimal(free);
    const short = toDecimal(total).minus(available);
    if (short.gt(0)) {
      blocks.push({
        kind: "funds",
        text: `Your escrow can pay ${fmt(available)} of the ${fmt(toDecimal(total))} owed. Add ${fmt(short)} first, or collecting it fails and the debt stays open.`,
        action: { label: `Add ${fmt(short)}`, href: FUNDING_DEPOSIT },
      });
    }
  }

  if (same(escrow.maxVoucherAmount)) {
    const largest = settling.reduce((max, debt) => Decimal.max(max, toDecimal(debt.amount)), new Decimal(0));
    const ceiling = toDecimal(escrow.maxVoucherAmount);
    if (largest.gt(ceiling)) {
      blocks.push({
        kind: "per-call",
        text: `A payment of ${fmt(largest)} is over your per-call ceiling of ${fmt(ceiling)}. Raise the per-call ceiling to at least ${fmt(largest)} first.`,
        action: { label: `Raise the per-call ceiling to ${fmt(largest)}`, href: FUNDING_CAPS },
      });
    }
  }

  if (same(escrow.maxPerWindow)) {
    const started = escrow.windowStartedAt ? new Date(escrow.windowStartedAt).getTime() : NaN;
    const current = !Number.isNaN(started) && started + escrow.windowSeconds * 1000 > now;
    const spent = current && same(escrow.spentInWindow) ? toDecimal(escrow.spentInWindow) : new Decimal(0);
    const left = Decimal.max(toDecimal(escrow.maxPerWindow).minus(spent), 0);
    if (toDecimal(total).gt(left)) {
      const needed = spent.plus(toDecimal(total));
      blocks.push({
        kind: "window",
        text: `Only ${fmt(left)} of your 24-hour ceiling is left, and ${fmt(toDecimal(total))} is owed. Raise the 24-hour ceiling to at least ${fmt(needed)} first, or wait until the window refills.`,
        action: { label: `Raise the 24-hour ceiling to ${fmt(needed)}`, href: FUNDING_CAPS },
      });
    }
  }
  return blocks;
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

/**
 * The deadline for one debt, in the reader's time: "Settle by …" for an open
 * one, the write-off for a written-off one, `null` while it is collected.
 */
export function debtDeadlineLine(debt: Pick<BuyerDebt, "state" | "writeOffAt">): string | null {
  const state = debtStateOf(debt);
  if (state === "OPEN") return `Settle by ${debtDeadline(debt.writeOffAt)}, or the provider goes unpaid.`;
  if (state === "WRITTEN_OFF") {
    return `Written off on ${debtDeadline(debt.writeOffAt)}, but still owed: settling still pays the provider.`;
  }
  return null;
}

/** The earliest write-off among the debts still open (every wallet's), or `null`. */
export function earliestWriteOff(data: BuyerDebts | null | undefined): string | null {
  const { own, others } = splitDebts(data);
  const open = [...own, ...others].filter((debt) => debtStateOf(debt) === "OPEN");
  if (open.length === 0) return null;
  return open.reduce((first, debt) => (debt.writeOffAt < first.writeOffAt ? debt : first)).writeOffAt;
}

/**
 * The line under an Owed call row. It claims paid calls are paused only when
 * the debts list says this call is owed: while the list loads, cannot be read,
 * or no longer has the call (settled since), it points at the receipt instead
 * (review 2026-10-17 P2-4). `callDebt` is the row's own flag, so a written-off
 * call says so even then (P3-3).
 */
export function owedRowText(
  state: OwedCallState,
  { pending = false, callDebt = null }: { pending?: boolean; callDebt?: CallDebt | null } = {},
): string {
  switch (state.kind) {
    case "collecting":
      return "Signed · being collected. Paid calls resume once it is.";
    case "other-wallet": {
      const deadline = debtStateOf(state.debt) === "OPEN" ? ` by ${debtDeadline(state.debt.writeOffAt)}` : "";
      return `Owed by another wallet of your organization: sign in with it to settle${deadline}.`;
    }
    case "settle":
      return debtStateOf(state.debt) === "WRITTEN_OFF"
        ? "Written off, still owed · paid calls paused until you settle; settling still pays the provider."
        : `Payment not collected · paid calls paused · settle by ${debtDeadline(state.debt.writeOffAt)}.`;
    case "unknown":
      if (pending) return "Payment not collected · checking what is owed…";
      return callDebt === "WRITTEN_OFF"
        ? "Written off · open the receipt for details."
        : "Payment not collected · open the receipt for details.";
  }
}

/**
 * What paid calls do once this settlement is collected, said honestly: they
 * resume only when nothing else is owed AND nothing else stops them — the
 * person's own pause, or an account block (review 2026-10-17 P2-5).
 */
export function paidCallsAfterSettling({
  resumes,
  pausedByYou,
  blocked,
}: {
  resumes: boolean;
  pausedByYou: boolean;
  blocked: boolean;
}): { short: string; sentence: string } {
  if (blocked) {
    return {
      short: "Still refused (account blocked)",
      sentence: "Paid calls stay refused while your account is blocked, even once this is collected.",
    };
  }
  if (!resumes) {
    return { short: "Still paused (more is owed)", sentence: "Paid calls stay paused until the rest is settled." };
  }
  if (pausedByYou) {
    return {
      short: "Still paused by you",
      sentence:
        "Once it is collected nothing is owed, but paid calls stay paused because you paused all paid calls: Resume in the banner to restart them.",
    };
  }
  return { short: "Resume in about a minute", sentence: "Paid calls resume once it is collected, in about a minute." };
}
