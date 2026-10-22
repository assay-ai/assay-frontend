import type { Money } from "./api";
import type { UnsignedChainTransaction } from "./chain-transaction";

/**
 * Agent payment delegation, as the backend's `/escrow/delegates` routes serve
 * it (`assay-backend/src/modules/settlement/dto/escrow-delegates.dto.ts`).
 *
 * A payer authorises a DELEGATE key — held by its headless agent — to sign
 * rail-B vouchers on the payer's escrow within caps and until `validUntil`. The
 * authorisation is an EIP-712 `AuthorizeDelegate` the payer's wallet signs once
 * and the platform relays; revocation is a `RevokeDelegate`, the same way.
 */
export type EscrowDelegateStatus = "ACTIVE" | "EXPIRED";

/**
 * Payments the platform served and the chain has not redeemed yet (BUG-D1-07).
 * The chain applies the caps standing AT REDEMPTION, so lowering a cap below
 * what these need, or revoking the key, leaves them unredeemable.
 */
export interface UnsettledVouchers {
  count: number;
  /** Their sum. */
  amount: Money;
  /** The largest single one: a per-payment cap below it strands it. */
  largest: Money;
  /** What the 24-hour cap must hold for all of them: the chain's counter plus these. */
  windowNeeds: Money;
  /** ISO-8601: the last instant the chain still redeems one of them, or null. */
  redeemableUntil: string | null;
}

export interface EscrowDelegate {
  /** CAIP-10. */
  delegate: string;
  maxVoucherAmount: Money;
  maxPerWindow: Money;
  /** The delegate's own rolling window, decayed to now. */
  spentInWindow: Money;
  /** ISO-8601. */
  validUntil: string;
  status: EscrowDelegateStatus;
  /** Payments this key signed that are still being settled. */
  unsettled: UnsettledVouchers;
}

export interface ListEscrowDelegates {
  account: string;
  delegates: EscrowDelegate[];
  /**
   * How long a tightening (a revoke, a shorter expiry, lower caps) waits before
   * it binds a payment already signed: 3600 on an escrow that keeps signed
   * payments collectable (assay-evm D-21), 0 where it binds at once (BUG-D1-07
   * applies).
   */
  tightenDelaySeconds: number;
}

/** `GET /escrow/unsettled`: every signer's unsettled payments, beside the escrow's own window. */
export interface EscrowUnsettled {
  account: string;
  /** null when the chain could not be read: unknown, not none. */
  unsettled: UnsettledVouchers | null;
  /**
   * How long a tightening (a revoke, a shorter expiry, lower caps) waits before
   * it binds a payment already signed: 3600 on an escrow that keeps signed
   * payments collectable (assay-evm D-21), 0 where it binds at once (BUG-D1-07
   * applies).
   */
  tightenDelaySeconds: number;
}

export type DelegationKind = "AUTHORIZE_DELEGATE" | "REVOKE_DELEGATE";

export interface DelegateIntent {
  kind: DelegationKind;
  account: string;
  transaction: UnsignedChainTransaction;
}

export interface RelayedDelegate {
  kind: DelegationKind;
  account: string;
  transactionHash: string;
  blockNumber: string;
  gasUsed: string;
  delegates: EscrowDelegate[];
  /**
   * Authorise only: the credentials whose payment key waiting for approval this
   * approval made their bound key. Empty when none (or the promotion failed).
   */
  promotedCredentialIds?: string[];
}

/** `POST /escrow/delegates/intent`. Atomic decimal strings; `validUntil` is unix seconds. */
export interface CreateDelegateIntentBody {
  delegate: string;
  maxVoucherAmount: string;
  maxPerWindow: string;
  validUntil: string;
  /** Accept that the new caps strand payments still being settled (BUG-D1-07). */
  acknowledgeUnsettled?: boolean;
}
