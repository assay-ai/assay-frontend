import type {
  PayoutChallenge,
  PayoutChallengeBody,
  ProvePayoutAddressBody,
  ProvePayoutAddressResponse,
} from "@/interfaces";

import { api } from "./api";

/**
 * Proving the payout address — a two-call flow, console only.
 *
 * There is no admin route, no CLI and no support path that reaches this
 * service on the backend, and that is the point: an address accepted over
 * email or a ticket is a phishing surface whose loss is every future payout.
 *
 * The console must **not** build the message to sign. `challenge.message` is
 * the only copy the platform verifies against, so hand exactly that string to
 * the wallet and send back only the signature.
 */

/**
 * `POST /providers/me/payout-address/challenge` — issue a nonce to sign.
 *
 * `chainId` (CAIP-2) and `address` (chain-native, e.g. base58) are separate
 * fields, not a pre-joined CAIP-10 id: a bare address means nothing without
 * knowing which chain validated it, and the canonical form comes back as
 * `accountId`.
 *
 * `404 PROVIDER_NOT_FOUND` when the organization has no provider row yet.
 */
export function createPayoutAddressChallenge(
  body: PayoutChallengeBody
): Promise<PayoutChallenge> {
  return api.post<PayoutChallenge>("/providers/me/payout-address/challenge", body);
}

/**
 * `POST /providers/me/payout-address` — redeem the signed challenge.
 *
 * Only `challengeId` and `signature`. The address and the message are read
 * off the stored challenge row, so the caller cannot decide what the
 * signature is checked against.
 *
 * `400 PROVIDER_PAYOUT_SIGNATURE_INVALID`, `409` for
 * `PROVIDER_PAYOUT_CHALLENGE_EXPIRED` / `…_ALREADY_USED` — three different
 * situations for the person holding the wallet, so branch on `code`.
 */
export function provePayoutAddress(
  body: ProvePayoutAddressBody
): Promise<ProvePayoutAddressResponse> {
  return api.post<ProvePayoutAddressResponse>("/providers/me/payout-address", body);
}
