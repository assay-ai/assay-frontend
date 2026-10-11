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
}

export interface ListEscrowDelegates {
  account: string;
  delegates: EscrowDelegate[];
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
}

/** `POST /escrow/delegates/intent`. Atomic decimal strings; `validUntil` is unix seconds. */
export interface CreateDelegateIntentBody {
  delegate: string;
  maxVoucherAmount: string;
  maxPerWindow: string;
  validUntil: string;
}
