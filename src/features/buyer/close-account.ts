import type { FullBalance } from "@/features/g30/balance";
import type { Money } from "@/interfaces";

/**
 * Close account, pure: what is still withdrawable, merged per asset.
 *
 * Several accounts on one chain in one asset are one total (the screen used to
 * print eight identical "Withdrawable balance · eip155:46630" rows). Two
 * different assets are never added together: a sum across chains is a promise
 * no single withdrawal keeps.
 */
export interface WithdrawableLine {
  asset: string;
  chainId: string;
  amount: Money;
  /** How many accounts were merged into this line. */
  accounts: number;
  /** False when at least one account's chain could not be read: the line may be short. */
  complete: boolean;
}

export function withdrawableByAsset(rows: readonly FullBalance[]): WithdrawableLine[] {
  const lines = new Map<string, WithdrawableLine>();
  for (const row of rows) {
    const value = row.withdrawable ?? (row.chainReadable === false ? null : row.available);
    const prev = lines.get(row.asset);
    const amount = BigInt(value?.amount ?? "0");
    if (prev) {
      prev.amount = { ...prev.amount, amount: (BigInt(prev.amount.amount) + amount).toString() };
      prev.accounts += 1;
      prev.complete = prev.complete && value !== null;
    } else {
      lines.set(row.asset, {
        asset: row.asset,
        chainId: row.chainId,
        amount: { amount: amount.toString(), asset: row.asset, decimals: row.decimals },
        accounts: 1,
        complete: value !== null,
      });
    }
  }
  return [...lines.values()];
}

/** True when nothing is left to withdraw on any line we could read. */
export function nothingToWithdraw(lines: readonly WithdrawableLine[]): boolean {
  return lines.every((line) => line.complete && BigInt(line.amount.amount) === 0n);
}
