import type { CreateStakeIntentBody, ProviderStake, StakeIntent } from "@/interfaces";

import { api } from "./api";

/**
 * Capital — the stake position, and the four unsigned stake intents.
 *
 * Every intent route returns **unsigned** bytes. The backend never holds a
 * provider key and never signs these; the wallet does, and nothing here can
 * change that. They are `POST` on something that writes nothing because the
 * responses carry a provider's balances, and a `GET` is what caches, proxies
 * and browser histories are entitled to keep.
 */

/**
 * `GET /providers/me/stake`.
 *
 * Read `hasKnownStake` and `chainReadable` **before** reading any figure. An
 * RPC outage and an unbonded provider both produce absent numbers, and the
 * two flags are what separate "unknown" from "zero" — the screen renders
 * through an outage rather than 500-ing, so the null-handling is the feature.
 *
 * Print `requirementRule` rather than the word "max": three product docs still
 * name the wrong rule, and the response is the authority.
 */
export function getProviderStake(): Promise<ProviderStake> {
  return api.get<ProviderStake>("/providers/me/stake");
}

/**
 * `GET /providers/me/stake`, revalidated past the browser's HTTP cache — for
 * the read right after a write that moves the requirement (a publish), where a
 * plain refetch would be served the pre-write body.
 */
export function revalidateProviderStake(): Promise<ProviderStake> {
  return api.getRevalidated<ProviderStake>("/providers/me/stake");
}

/**
 * `POST /providers/me/stake/open-stake-intent` — open the on-chain stake
 * account. Takes no body: the instruction carries no amount and moves no
 * tokens.
 *
 * First, and nothing works without it — deposit requires an already-existing
 * account, and it is deliberately not `init_if_needed`. The provider pays rent
 * for their own account; `preflight` quotes it before they sign.
 *
 * `409` = no proved stake authority, or the account is already open.
 * `503 PROVIDER_STAKE_CHAIN_UNAVAILABLE` = nothing was built.
 */
export function createOpenStakeIntent(): Promise<StakeIntent> {
  return api.post<StakeIntent>("/providers/me/stake/open-stake-intent");
}

/**
 * `POST /providers/me/stake/deposit-intent` — move stake in.
 *
 * Staking needs the stake asset **and** native gas. Both requirements and both
 * current balances are on `preflight` before a wallet opens; gas is
 * deliberately not sponsored and `preflight.gasNotSponsoredReason` carries the
 * sentence to print.
 */
export function createStakeDepositIntent(body: CreateStakeIntentBody): Promise<StakeIntent> {
  return api.post<StakeIntent>("/providers/me/stake/deposit-intent", body);
}

/**
 * `POST /providers/me/stake/unstake-intent` — start the unbonding clock.
 *
 * Moves stake from bonded to unbonding. It stays fully slashable for the whole
 * period — that is what the period is for — and it stops counting toward the
 * routing gate immediately, because the gate reads `bonded` alone.
 */
export function createUnstakeIntent(body: CreateStakeIntentBody): Promise<StakeIntent> {
  return api.post<StakeIntent>("/providers/me/stake/unstake-intent", body);
}

/**
 * `POST /providers/me/stake/withdraw-intent` — take matured stake out, or say
 * which limit bit.
 *
 * A blocked withdrawal is still a **201** with `transaction: null`: the
 * request was answered and the answer is the limit. Check `blockedBy` before
 * `transaction` — `UNBONDING_NOT_MATURED` resolves with time, and
 * `withdrawable` says what would have gone through.
 */
export function createStakeWithdrawIntent(body: CreateStakeIntentBody): Promise<StakeIntent> {
  return api.post<StakeIntent>("/providers/me/stake/withdraw-intent", body);
}
