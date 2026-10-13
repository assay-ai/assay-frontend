import { formatMoneyNonZero } from "@/utils/money";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";

/** `0x3bec0b…e5e3cb`. A 32-byte id keeps six hex characters at each end. */
export function shortRequestId(requestId: string): string {
  const body = requestId.startsWith("0x") ? requestId.slice(2) : requestId;
  if (body.length <= 12) return requestId;
  return `0x${body.slice(0, 6)}…${body.slice(-6)}`;
}

/**
 * Atomic units → `1.00 USDG`, truncated never rounded (the app's one
 * convention, `utils/money.ts`), with sub-cent amounts written out in full so
 * a one-unit penalty never reads as zero.
 */
export function formatAtomic(amount: bigint, decimals: number, symbol: string): string {
  const text = formatMoneyNonZero(
    { amount: amount.toString(), asset: "", decimals },
    { symbol: "" },
  );
  return `${text} ${symbol}`;
}

/** Unix seconds → ISO, for `stampUtc`. */
export function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * `Constants.SLASH_EXECUTION_GRACE_SECONDS` (7 days, `assay-evm/src/Constants.sol`):
 * from `executableAt + grace` a pending record can no longer be executed, only
 * expired, which releases the reserved stake.
 */
export const SLASH_EXECUTION_GRACE_SECONDS = 7 * 86_400;

export type PendingPhase =
  /** The 72h wait is running: the provider can still dispute. */
  | { readonly phase: "disputable"; readonly secondsLeft: number }
  /** The wait is over: anybody may execute it, until the grace ends. */
  | { readonly phase: "executable"; readonly secondsLeft: number }
  /** The grace is over: it can only be expired, which releases the stake. */
  | { readonly phase: "expirable" };

/** Where a Pending record is on its clock. `null` for any other status. */
export function pendingPhase(row: ChainSlashRow, nowSeconds: number): PendingPhase | null {
  if (row.status.key !== "pending") return null;
  if (nowSeconds < row.executableAt) {
    return { phase: "disputable", secondsLeft: row.executableAt - nowSeconds };
  }
  const closes = row.executableAt + SLASH_EXECUTION_GRACE_SECONDS;
  if (nowSeconds < closes) return { phase: "executable", secondsLeft: closes - nowSeconds };
  return { phase: "expirable" };
}
