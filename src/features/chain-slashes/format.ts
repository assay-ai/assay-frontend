import { toDecimal } from "@/utils/money";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import type { SlashStatusKey } from "@/libs/chains/evm/stake-slashes/status";

/** `0x3bec0b…e5e3cb`. A 32-byte id keeps six hex characters at each end. */
export function shortRequestId(requestId: string): string {
  const body = requestId.startsWith("0x") ? requestId.slice(2) : requestId;
  if (body.length <= 12) return requestId;
  return `0x${body.slice(0, 6)}…${body.slice(-6)}`;
}

/**
 * Atomic units → `0.150001 USDG`, exact. A penalty is a figure the provider
 * checks against the chain, so no digit of it is rounded or truncated away:
 * every significant decimal is shown, and only trailing zeros past the cents
 * are dropped (`1.00 USDG`, `0.15 USDG`, `0.150001 USDG`).
 */
export function formatAtomic(amount: bigint, decimals: number, symbol: string): string {
  const fixed = toDecimal({ amount: amount.toString(), asset: "", decimals }).toFixed(
    Math.max(decimals, 2),
  );
  const [whole, fraction = ""] = fixed.split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${trimmed} ${symbol}`;
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

/**
 * How loud the dispute countdown is: a warning under a day left, danger under
 * six hours. Above a day the clock is information, not an alarm.
 */
export type CountdownUrgency = "normal" | "warning" | "danger";

export const URGENCY_WARNING_SECONDS = 24 * 3_600;
export const URGENCY_DANGER_SECONDS = 6 * 3_600;

export function countdownUrgency(secondsLeft: number): CountdownUrgency {
  if (secondsLeft < URGENCY_DANGER_SECONDS) return "danger";
  if (secondsLeft < URGENCY_WARNING_SECONDS) return "warning";
  return "normal";
}

/**
 * The label over a record's reserved amount. Only an open record still holds
 * stake back; once it is executed or cancelled the reservation is history.
 */
export function reservedLabel(status: SlashStatusKey): string {
  return status === "executed" || status === "cancelled" ? "Was reserved" : "Reserved from your stake";
}

/**
 * The label over `executableAt`. While a Pending record's dispute window is
 * open, that instant is also the provider's deadline to dispute it, so the
 * label says both.
 */
export function executableAtLabel(row: ChainSlashRow, nowSeconds: number): string {
  return pendingPhase(row, nowSeconds)?.phase === "disputable"
    ? "Dispute before · can be executed from"
    : "Can be executed from";
}
