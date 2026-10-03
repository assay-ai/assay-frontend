import type { Money } from "@/interfaces";
import { withDemoChain } from "@/libs/chains/demo-chains";

import { api } from "./api";

export interface AccountBalance {
  /**
   * CAIP-2. The chain this balance is held on and spent on. Balances are per
   * chain and are NEVER combined: two chains are two rows, and there is
   * deliberately no field that spans them.
   */
  chainId: string;
  /** CAIP-10. Which account this row is. */
  accountId: string;
  asset: string;
  decimals: number;
  available: Money;
  held: Money;
  /**
   * `available + held + pending` WITHIN this one account and asset — therefore
   * within this one chain. **Not a cross-chain sum, and there must never be
   * one.** The name is the backend's; do not add a second `total` above the
   * list of rows on any screen.
   */
  total?: Money;
  /**
   * `AccountBalanceDto.chainReadable` — whether the chain was read for THIS
   * row, per `(account, asset)`.
   *
   * **Required, and declared here rather than only on `FullBalance`.** It is on
   * every `GET /balances` row and always has been; leaving it off the service
   * type is what let five screens read chain-derived figures without ever
   * asking whether a chain had answered. `false` means `chainBalance`,
   * `spendable` and `withdrawable` are `null` because they are UNKNOWN — not
   * zero, and not "no escrow yet", which is what the same three nulls mean
   * when this is true. Render the three states through
   * `@/features/chain-read`; never fall through this to a ledger figure.
   */
  chainReadable: boolean;
}

export interface BalancesResponse {
  balances: AccountBalance[];
}

/** GET /balances — the figure the Overview and Funding screens both lead with. */
export async function getBalances(): Promise<BalancesResponse> {
  const response = await api.get<BalancesResponse>("/balances");
  /*
    DEMO ONLY, and a no-op unless `NEXT_PUBLIC_DEMO_CHAINS` is set — see
    `libs/chains/demo-chains.ts`. It names the chain on rows that predate the
    per-chain ledger; it does not touch a single money figure.
  */
  return { ...response, balances: withDemoChain(response.balances ?? []) };
}

export interface WithheldResponse {
  total?: Money;
  buckets?: unknown[];
  reconciliation?: unknown;
  [key: string]: unknown;
}

/**
 * GET /withheld — the number the Guarantee screen exists to show. The product's
 * central claim is invisible by construction (a refund is a released hold), so
 * this endpoint is the only place it becomes a figure.
 */
export function getWithheld(params?: { from?: string; to?: string }): Promise<WithheldResponse> {
  return api.get<WithheldResponse>("/withheld", params);
}

export function getHolds(): Promise<unknown> {
  return api.get("/holds");
}
