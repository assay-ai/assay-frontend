import type {
  ProveStakeAuthorityBody,
  ProveStakeAuthorityResponse,
  StakeAuthorityChallenge,
  StakeAuthorityChallengeBody,
} from "@/interfaces";

import { api } from "./api";

/**
 * Proving the stake authority — the same two-call shape as the payout address,
 * and console only for a sharper reason: this link decides whose collateral a
 * slash attestation points at.
 *
 * Nothing in the request names the account being proved. If it could, provider
 * A could name provider B's pubkey, clear the router's stake gate on B's
 * collateral, and on defecting have the platform's attestation point at B's
 * PDA. The account comes off the challenge row, where the platform put it.
 */

/**
 * `POST /providers/me/stake-authority/challenge`.
 *
 * The chain id is load-bearing here in a way it is not for a payout address:
 * `stake_authority` stores the CAIP-10 form, so the chain travels with the key
 * and a devnet stake account can never be read as the mainnet one.
 */
export function createStakeAuthorityChallenge(
  body: StakeAuthorityChallengeBody
): Promise<StakeAuthorityChallenge> {
  return api.post<StakeAuthorityChallenge>("/providers/me/stake-authority/challenge", body);
}

/**
 * `POST /providers/me/stake-authority` — redeem the signed challenge.
 *
 * Four failure shapes worth branching on, all by `ApiError.code`:
 *
 *  - `400` — the signature does not verify.
 *  - `409 PROVIDER_STAKE_CHALLENGE_EXPIRED` / `…_ALREADY_USED`.
 *  - `409 PROVIDER_STAKE_AUTHORITY_ALREADY_CLAIMED` — another provider proved
 *    that account first.
 *  - `409 PROVIDER_STAKE_AUTHORITY_STILL_FUNDED` — the current authority still
 *    names an account holding slashable collateral (bonded, unbonding or
 *    exposed). Rotating out of it would have been a slash escape hatch.
 *  - `503 PROVIDER_STAKE_AUTHORITY_CHECK_UNAVAILABLE` — the current stake
 *    account could not be read, so nothing changed and **nothing was
 *    consumed**. This one is retryable with the same challenge while it is
 *    still valid; the others are not.
 */
export function proveStakeAuthority(
  body: ProveStakeAuthorityBody
): Promise<ProveStakeAuthorityResponse> {
  return api.post<ProveStakeAuthorityResponse>("/providers/me/stake-authority", body);
}
