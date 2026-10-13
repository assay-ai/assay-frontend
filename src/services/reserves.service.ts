import { api } from "./api";
import { getPublicFeatures } from "./public-features.service";

/**
 * Proof of reserves — the one anonymous read in this app.
 *
 * `ApiClient` attaches `Authorization` only when a token exists, so signed-out
 * callers already send none and nothing special is needed here. That is the
 * point of the endpoint: a reader who had to authenticate to check that their
 * custodian holds what it owes would be trusting the custodian's answer about
 * itself, which is the thing proof of reserves replaces.
 *
 * ## Absent is not zero
 *
 * Every nullable field below means *not known*, never *none*. `$0.00` on this
 * page is a claim about somebody's money; silence is not. The page must render
 * each null as its own state and never substitute a figure:
 *
 * - `vaultBalance` / `totalLiabilities` / `difference` — null while `state` is
 *   `NO_RECONCILIATION` (nothing has ever run here) or `LAST_CHECK_FAILED`
 *   (the last run could not read the chain).
 * - `vaultSlot` — null for every run recorded before the migration that added
 *   the column. Renders as `—`, never as a zero or a guess.
 * - `stake` — null until the stake monitor's sweep has produced a snapshot.
 */

export enum PublicReservesState {
  NORMAL = "NORMAL",
  NO_RECONCILIATION = "NO_RECONCILIATION",
  LAST_CHECK_FAILED = "LAST_CHECK_FAILED",
}

export interface PublicReservesStake {
  bondedTotal: string;
  decimals: number;
  asset: string;
  providerCount: number;
  /**
   * When the CHAIN was read for this figure.
   *
   * Deliberately **not** `reconciledAt`. The snapshot comes off a different
   * cron than the reconciliation — measured 1.2s apart on the local stack, and
   * arbitrarily far apart whenever one of the two is failing. Printing one
   * timestamp for both would assert a simultaneity that does not exist.
   */
  readAt: string;
}

export interface PublicReservesHistoryRow {
  checkedAt: string;
  vaultBalance: string | null;
  totalLiabilities: string | null;
  difference: string | null;
  vaultSlot: string | null;
  /** The run could not read the chain. Shown as a row, not hidden. */
  failed: boolean;
}

export interface PublicReserves {
  state: PublicReservesState;
  asset: string | null;
  /** `USDC`, from the backend's asset registry. Null rather than guessed. */
  assetSymbol: string | null;
  decimals: number | null;
  vaultAccount: string | null;
  vaultBalance: string | null;
  totalLiabilities: string | null;
  /** Signed. Negative is a shortfall, positive a surplus. */
  difference: string | null;
  accounts: number | null;
  vaultSlot: string | null;
  reconciledAt: string | null;
  stake: PublicReservesStake | null;
  history: PublicReservesHistoryRow[];
}

/**
 * `null` means this deployment publishes no reserves page: the route is not
 * registered, which `GET /public/features` says without it being called.
 *
 * That is not an error: the page says proof of reserves is not available yet.
 * Rendering zeros would say this deployment holds no reserves — the page would
 * be making the one kind of false claim it exists to prevent.
 */
export async function getPublicReserves(): Promise<PublicReserves | null> {
  if (!(await getPublicFeatures()).reserves) return null;
  return api.get<PublicReserves>("/public/reserves");
}
