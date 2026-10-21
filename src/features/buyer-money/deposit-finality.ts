import type { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/libs/ApiClient";
import { OVERVIEW_KEY } from "@/features/buyer/use-overview";
import { ME_STATUS_KEY } from "@/features/me-status/keys";
import { getDeposit, listDeposits, type Deposit } from "@/services/funding.service";

import { CONFIRMING_SLOW_POLL_MS } from "./confirming";

/**
 * Waiting for a deposit to be final, without polling `GET /balances`.
 *
 * While a balance shows money "still confirming on chain" (`anyConfirming`),
 * the deposits behind it are read instead: once from `GET /deposits` to find
 * them, then each from `GET /deposits/:id` (a cheap read) until it is no
 * longer pending. When one is decided — `finality` `CONFIRMED` or `REJECTED`,
 * or the deposit failed or expired — `GET /balances` is read ONCE, with the
 * escrow, the debts and the Overview, so the confirming line goes exactly when
 * the ledger moved the money. `/balances` is a heavy read the API limits to
 * 30 a minute per person; the old 3-second poll of it would hit that with two
 * tabs open.
 *
 * An API without `finality` (older than the field) cannot answer this: the
 * wait says so (`legacy`) and the balances poll as they did.
 */

export const DEPOSIT_FINALITY_KEY = ["deposit-finality"] as const;

/** The statuses a deposit behind "still confirming" can be in. */
const CANDIDATE_STATUSES = ["CREATED", "SETTLING", "SETTLED"];

export interface DepositFinalityWait {
  /** The deposits still pending, read again on the next tick. Empty: look them up again. */
  pending: string[];
  /** The API predates `finality`: poll `/balances` as before. */
  legacy: boolean;
  /** When this wait last read `/balances` again, so a mismatch cannot turn into a fast `/balances` poll. */
  refreshedAt: number | null;
}

/** Whether this deposit still holds money in "still confirming on chain". */
export function depositStillPending(deposit: Deposit, nowMs: number): boolean {
  if (deposit.status === "SETTLING") return true;
  // Counted in `pendingDeposits` until it expires, as `GET /balances` counts it.
  if (deposit.status === "CREATED") return Date.parse(deposit.expiresAt) > nowMs;
  return deposit.status === "SETTLED" && deposit.finality === "PENDING";
}

/** A deposit that is gone (404) is no longer pending; any other failure fails the tick, to be tried again. */
async function readWatched(id: string): Promise<Deposit | null> {
  try {
    return await getDeposit(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function predatesFinality(deposits: readonly Deposit[]): boolean {
  return deposits.some((deposit) => !("finality" in deposit));
}

/** What the old completion refreshed, plus the debts and the Overview: everything a credit moves. */
export function refreshAfterDeposit(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["balances"] });
  void queryClient.invalidateQueries({ queryKey: ["escrow"] });
  void queryClient.invalidateQueries({ queryKey: ["deposits"] });
  void queryClient.invalidateQueries({ queryKey: ME_STATUS_KEY });
  void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
}

/**
 * One tick of the wait. Reads the deposits it is waiting on (or finds them),
 * and refreshes the balances when one of them was decided — or, when none is
 * pending although the balances still say confirming, at most every 30
 * seconds.
 */
export async function depositFinalityTick(
  queryClient: QueryClient,
  now: () => number = Date.now,
): Promise<DepositFinalityWait> {
  const previous = queryClient.getQueryData<DepositFinalityWait>(DEPOSIT_FINALITY_KEY);
  const watching = previous?.pending ?? [];
  const deposits =
    watching.length > 0
      ? (await Promise.all(watching.map(readWatched))).filter((deposit): deposit is Deposit => deposit !== null)
      : (await listDeposits({ status: CANDIDATE_STATUSES, limit: 50 })).items ?? [];
  const refreshedAt = previous?.refreshedAt ?? null;
  if (predatesFinality(deposits)) return { pending: [], legacy: true, refreshedAt };

  const at = now();
  const pending = deposits.filter((deposit) => depositStillPending(deposit, at)).map((deposit) => deposit.id);
  const decided = watching.some((id) => !pending.includes(id));
  const mismatch = pending.length === 0 && (refreshedAt === null || at - refreshedAt >= CONFIRMING_SLOW_POLL_MS);
  if (decided || mismatch) {
    refreshAfterDeposit(queryClient);
    return { pending, legacy: false, refreshedAt: at };
  }
  return { pending, legacy: false, refreshedAt };
}
