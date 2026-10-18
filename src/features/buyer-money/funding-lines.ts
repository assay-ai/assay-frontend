import Decimal from "decimal.js";

import type { EscrowLifetime, Money } from "@/interfaces";
import type { ToolCall } from "@/services/tool-calls.service";
import type { StatementBalance, Withdrawal } from "@/services/funding.service";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * The Funding page's result lines (B7), pure: the reconciliation sentence,
 * the "still refundable" line, the withdrawal history's words, and a
 * statement's money lines. Every figure comes from the API; nothing here
 * decides a money outcome.
 */

function money(value: Money | null | undefined): string {
  return formatMoney(value, { decimals: 2 });
}

/**
 * "Deposited $68.70 − spent $8.70 − withdrawn $0.00 = $60.00", from the
 * chain's lifetime counters. `null` when the chain keeps none (or the API is
 * older), or when they do not add up to the balance read with them: the line
 * is shown only when it is true.
 */
export function reconciliationLine(lifetime: EscrowLifetime | null | undefined, balance: Money | null | undefined): string | null {
  if (!lifetime || !balance) return null;
  const derived = toDecimal(lifetime.deposited).minus(toDecimal(lifetime.spent)).minus(toDecimal(lifetime.withdrawn));
  if (!derived.eq(toDecimal(balance))) return null;
  return `Deposited ${money(lifetime.deposited)} − spent ${money(lifetime.spent)} − withdrawn ${money(lifetime.withdrawn)} = ${money(balance)}`;
}

export interface RefundableSummary {
  count: number;
  total: Money;
  /** The soonest a refund answer lapses; null when none is known yet. */
  soonestUntil: string | null;
}

/**
 * The calls `GET /tool-calls?refundable=true` returned: how many, their
 * charge, and the soonest end. `null` when there are none. The list is the
 * backend's own answer; this only adds it up.
 */
export function refundableSummary(calls: readonly Pick<ToolCall, "charged" | "refundableIfReportedUntil">[] | undefined): RefundableSummary | null {
  if (!calls || calls.length === 0) return null;
  const first = calls[0]!.charged;
  const sum = calls.reduce((total, call) => total.plus(toDecimal(call.charged)), new Decimal(0));
  const ends = calls
    .map((call) => call.refundableIfReportedUntil)
    .filter((until): until is string => typeof until === "string")
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    count: calls.length,
    total: { amount: sum.mul(new Decimal(10).pow(first.decimals)).toFixed(0), asset: first.asset, decimals: first.decimals },
    soonestUntil: ends[0] ?? null,
  };
}

/**
 * "$0.26 charged recently (3 calls) is still covered: a report accepted for
 * any of them is refunded in full." The refund always carries its condition,
 * an accepted report (B7 review M1); `atLeast` when the list was cut short.
 */
export function refundableLine(summary: RefundableSummary, atLeast = false): string {
  const calls = summary.count === 1 ? "1 call" : `${summary.count} calls`;
  const amount = `${atLeast ? "At least " : ""}${money(summary.total)}`;
  return `${amount} charged recently (${calls}) is still covered: a report accepted for any of them is refunded in full.`;
}

/** The Calls row under Still refundable: "Refunded in full if you report it by <time> and the report is accepted". */
export const REFUNDABLE_ROW = {
  beforeTime: "Refunded in full if you report it by",
  afterTime: "and the report is accepted",
  noEnd: "Refunded in full if you report it and the report is accepted; the 1-hour hold starts when the payment is collected",
  /** The Still refundable chip's empty state. */
  empty: "No charged call is covered right now: none would be refunded in full by an accepted report. A call stays here for its 1-hour hold, on chains that have one.",
  /** The Reports empty state, pointing at the chip. */
  pointer: "Still refundable lists the calls that would be refunded in full if you report them now and the report is accepted.",
} as const;

/**
 * The finished withdrawals to list under Funding. A pending one is left out:
 * the escrow card shows the live request (the history trails the chain by
 * a few minutes, and could still say pending after a claim).
 */
export function finishedWithdrawals(items: readonly Withdrawal[] | undefined): Withdrawal[] {
  return (items ?? []).filter((item) => item.status !== "PENDING");
}

/** One history row's outcome, in words. */
export function withdrawalOutcome(item: Withdrawal): { label: string; tone: "success" | "neutral"; amount: string } {
  switch (item.status) {
    case "CLAIMED": {
      const short = item.requested && item.received && toDecimal(item.received).lt(toDecimal(item.requested));
      return {
        label: short ? `Claimed, ${money(item.received)} of ${money(item.requested)} asked` : "Claimed",
        tone: "success",
        amount: money(item.received),
      };
    }
    case "CANCELLED":
      return { label: "Cancelled, nothing moved", tone: "neutral", amount: money(item.requested) };
    case "REPLACED":
      return { label: "Replaced by a newer request", tone: "neutral", amount: money(item.requested) };
    default:
      return { label: "Requested", tone: "neutral", amount: money(item.requested) };
  }
}

export interface StatementMoneyLine {
  key: "opening" | "deposits" | "withdrawals" | "paid" | "closing";
  label: string;
  value: string;
}

/** Opening + deposits − withdrawals − paid = closing, as the statement prints it. */
export function statementMoneyLines(balance: StatementBalance): StatementMoneyLine[] {
  return [
    { key: "opening", label: "Opening balance", value: money(balance.opening) },
    { key: "deposits", label: "Deposits", value: `+${money(balance.deposits)}` },
    { key: "withdrawals", label: "Withdrawals", value: `−${money(balance.withdrawals)}` },
    { key: "paid", label: "Paid from your escrow", value: `−${money(balance.paid)}` },
    { key: "closing", label: "Closing balance", value: money(balance.closing) },
  ];
}

/**
 * The sentence under a statement's closing balance. Only for a month that has
 * not ended (the API checks it against the escrow then); a difference is
 * stated, never explained away. The API's rule is
 * `difference = escrow − still settling − closing`, and the sentence walks
 * the same arithmetic (B7 review M2): payments still being collected are in
 * the escrow but already in Paid.
 */
export function statementCheckSentence(balance: StatementBalance): string | null {
  const check = balance.check;
  if (!check) return null;
  const escrow = toDecimal(check.escrowBalance);
  const settling = toDecimal(check.stillSettling);
  const scale = new Decimal(10).pow(check.escrowBalance.decimals);
  const asMoney = (value: Decimal): Money => ({ ...check.escrowBalance, amount: value.mul(scale).toFixed(0) });
  const net = escrow.minus(settling);
  const holds = `Your escrow holds ${money(check.escrowBalance)}`;
  if (check.matches) {
    return settling.gt(0)
      ? `${holds}. ${money(check.stillSettling)} of it is already paid for calls and still being collected on chain, which leaves ${money(asMoney(net))}: this closing balance.`
      : `${holds}: this closing balance.`;
  }
  const difference = toDecimal(check.difference);
  const gap = `${money(asMoney(difference.abs()))} ${difference.isNegative() ? "less" : "more"} than this closing balance`;
  const lead = settling.gt(0)
    ? `${holds}; less ${money(check.stillSettling)} still being collected on chain, that is ${money(asMoney(net))}, ${gap}.`
    : `${holds}, ${gap}.`;
  return `${lead} Activity outside these records (from before they began, or made outside Assay) can explain it.`;
}
