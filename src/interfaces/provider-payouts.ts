import type { Eip712Domain, Eip712Field } from "./chain-transaction";
/**
 * Payouts, and the signed proof of the address they land at.
 *
 * Source: assay-backend `src/modules/provider/dto/get-provider-payouts.dto.ts` and
 * `prove-payout-address.dto.ts`.
 *
 * The proof pair lives here rather than with registration because it is the
 * payout wallet, even though the onboarding step counter calls it step 2.
 */

import type { ListQuery, Money } from "./api";

/**
 * No resource-specific filters. Sortable field: `createdAt` only, which is
 * also the default; anything else answers `API_UNKNOWN_SORT_FIELD`.
 *
 * `search` is inherited from `ListQuery` and is **inert here**: the shared
 * query DTO accepts it, but this resource applies no free-text predicate, so
 * a search value is silently ignored rather than rejected. Do not offer a
 * search box against it. (`/verdicts` has the same defect on the buyer side.)
 */
export interface ListProviderPayoutsQuery extends ListQuery {
  /** ISO-8601, inclusive lower bound on `createdAt`. */
  from?: string;
  /** ISO-8601, exclusive upper bound on `createdAt`. */
  to?: string;
}

/**
 * One `PAYOUT` ledger entry — a line in a payout batch, not the batch.
 *
 * There is no batch row to paginate, so this pages entries. A provider dealing
 * in a single asset sees one row per batch; one paid out in two assets in the
 * same run sees two rows sharing a `batchId`, which is the honest ledger shape
 * rather than a synthetic merge. Group by `batchId` client-side if the screen
 * wants batches.
 */
export interface ProviderPayout {
  /** The ledger entry id. */
  id: string;
  /** The payout run this entry belongs to. */
  batchId: string;
  amount: Money;
  /** On-chain transaction reference, once sent. */
  chainTxRef: string | null;
  createdAt: string;
}

// ── Payout address proof ───────────────────────────────────────────────────

/**
 * `POST /providers/me/payout-address/challenge`.
 *
 * A CAIP-2 chain id plus a chain-native address — see the stake-authority
 * twin for why the two are separate fields rather than one CAIP-10 string.
 */
export interface PayoutChallengeBody {
  chainId: string;
  address: string;
}

/**
 * `message` is the exact string the wallet must sign. The console must not
 * construct it locally: the stored challenge row is the only copy the prove
 * call verifies against.
 */
export interface PayoutChallenge {
  challengeId: string;
  /** 32 random bytes, lower-case hex. */
  nonce: string;
  message: string;
  messageVersion: string;
  /** CAIP-10 — the canonical form of the address being claimed. */
  accountId: string;
  expiresAt: string;
  /** eip155: what the wallet signs (EIP-712). `null` on Solana, where `message` is. */
  typedData: ProofTypedData | null;
}

/**
 * A proof challenge as an EIP-712 request. Every value is a string — the
 * domain's `chainId` and `message.expiresAt` included — so it survived JSON.
 */
export interface ProofTypedData {
  domain: Eip712Domain;
  types: Record<string, readonly Eip712Field[]>;
  primaryType: string;
  message: Record<string, string>;
}

/**
 * `POST /providers/me/payout-address`.
 *
 * Only these two. Accepting the address or the message from the body would
 * let the caller — not the platform — decide what the signature is checked
 * against.
 */
export interface ProvePayoutAddressBody {
  challengeId: string;
  /** Solana: base58 ed25519 over `message`. eip155: 0x-hex EIP-712 over `typedData`. */
  signature: string;
}

export interface PayoutProof {
  challengeId: string;
  signature: string;
  messageVersion: string;
  provedAt: string;
}

export interface ProvePayoutAddressResponse {
  /**
   * CAIP-10 — now the address the platform pays out to **on this address's own
   * chain**. One enrolment per chain, so proving here changes
   * nothing about any other chain the provider is enrolled on, and it carries
   * no status: re-proving deliberately leaves a `SUSPENDED` enrolment
   * suspended. The status lives on `registration.payoutAccounts`.
   */
  payoutAccountId: string;
  provedAt: string;
  proof: PayoutProof;
}
