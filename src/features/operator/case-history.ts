import { stampUtc } from "@/features/g34a/stats";
import { formatMoney } from "@/utils/money";

/**
 * A stored penalty History sentence, as the operator console prints it: amounts
 * the backend wrote in minor units become money, and a binding id becomes the
 * tool's name (operators never see UUIDs, BUG-OPS-CASES-03), the
 * "de-minimis floor" jargon reads as the provider History does, and a raw
 * ISO instant is a "YYYY-MM-DD HH:MM UTC" stamp (lot 1 E18). Rows written
 * before the backend moved to dollars keep their minor units, and the
 * "taken from stake" line still writes them, so both are read here. Any other
 * sentence is printed as it is.
 */
export interface CaseHistoryContext {
  asset: string;
  decimals: number;
  toolName: string;
  bindingId: string;
}

export function operatorEventSummary(summary: string, context: CaseHistoryContext): string {
  const money = (amount: string) => formatMoney({ amount, asset: context.asset, decimals: context.decimals });
  return summary
    .replace(
      /^Slash proposed: (\d+) against (\S+)$/,
      (_, amount: string, binding: string) =>
        `Penalty of ${money(amount)} proposed against ${binding === context.bindingId ? context.toolName : "the binding"}`,
    )
    .replace(/^Penalty of (\$\S+) proposed$/, (_, amount: string) => `Penalty of ${amount} proposed against ${context.toolName}`)
    .replace(
      /^Penalty of (\$\S+) is below the de-minimis floor; recorded, not levied$/,
      (_, amount: string) => `Penalty of ${amount} is below the minimum penalty; it is recorded but not charged`,
    )
    .replace(
      /^Penalty of (\d+) is below the de-minimis floor; recorded, not levied$/,
      (_, amount: string) => `Penalty of ${money(amount)} is below the minimum penalty; it is recorded but not charged`,
    )
    .replace(/^Penalty of (\d+) taken from stake$/, (_, amount: string) => `Penalty of ${money(amount)} taken from stake`)
    .replace(
      /^(\d+) (of stake is reserved|deposited back into stake|was taken from stake)/,
      (_, amount: string, rest: string) => `${money(amount)} ${rest}`,
    )
    .replace(ISO_INSTANT, (iso) => `${stampUtc(iso)} UTC`);
}

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
