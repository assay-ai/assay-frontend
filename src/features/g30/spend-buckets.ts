import Decimal from "decimal.js";

import type { ReceiptsSummary } from "@/features/g30/wire";
import type { Money } from "@/interfaces";
import type { ToolCall } from "@/services/tool-calls.service";
import { formatMoney } from "@/utils/money";

const IN_PROGRESS_STATUSES = new Set(["CREATED", "FUNDS_SECURED", "PROVIDER_EXECUTING", "VERIFYING"]);

/**
 * One call in the summary's buckets, the way `GET /receipts/summary` counts it:
 * listed = charged + not charged + owed + in progress. An open or written-off
 * debt is owed (the buyer still owes it: paid calls stay refused until it
 * re-signs); a forfeited or voided call is not charged.
 */
export function callBuckets(call: ToolCall): {
  charged: ToolCall["price"];
  notCharged: ToolCall["price"];
  owed: ToolCall["price"];
  inProgress: ToolCall["price"];
} {
  const money = (amount: Decimal.Value) => ({
    amount: new Decimal(amount).toFixed(0),
    asset: call.price.asset,
    decimals: call.price.decimals,
  });
  const price = call.price.amount;
  if (IN_PROGRESS_STATUSES.has(call.status)) {
    return { charged: money(0), notCharged: money(0), owed: money(0), inProgress: money(price) };
  }
  if (call.debt === "OUTSTANDING" || call.debt === "WRITTEN_OFF") {
    return { charged: money(0), notCharged: money(0), owed: money(price), inProgress: money(0) };
  }
  const charged = Decimal.min(call.charged.amount, price);
  return {
    charged: money(charged),
    notCharged: money(new Decimal(price).minus(charged)),
    owed: money(0),
    inProgress: money(0),
  };
}

/**
 * How the totals add up, in one line: listed = charged + not charged + owed
 * (+ in progress). Owed is a served call whose payment is not collected yet —
 * neither charged nor let off — so it is its own figure.
 */
export function reconcileSentence(totals: ReceiptsSummary["totals"]): string {
  const parts = [
    `${formatMoney(totals.chargedTotal)} charged`,
    `${formatMoney(totals.notChargedTotal)} not charged`,
  ];
  if (totals.owedCalls > 0) parts.push(`${formatMoney(totals.owedTotal)} owed (not collected yet)`);
  if (totals.inProgressCalls > 0) parts.push(`${formatMoney(totals.inProgressTotal)} in progress`);
  return `Listed ${formatMoney(totals.listedTotal)} = ${parts.join(" + ")}.`;
}

/**
 * What a summary window spent: charged plus owed. Owed (open or written-off
 * buyer debt) is spend the buyer still owes, so a "spent today" figure leaves
 * it out only by understating the day (final review M1). In-progress calls are
 * not spent yet. `null` when the summary carries no charged figure.
 */
export function spentFromTotals(
  totals: { chargedTotal?: Money | null; owedTotal?: Money | null } | null | undefined,
): Money | null {
  const charged = totals?.chargedTotal ?? null;
  if (!charged) return null;
  const owed = totals?.owedTotal ?? null;
  if (!owed || owed.asset !== charged.asset || owed.decimals !== charged.decimals) return charged;
  return { ...charged, amount: (BigInt(charged.amount) + BigInt(owed.amount)).toString() };
}
