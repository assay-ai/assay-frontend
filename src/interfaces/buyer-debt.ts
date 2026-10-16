import type { Money } from "./api";

/**
 * Buyer debt, as assay-backend `payment/dto/buyer-debt.dto.ts` serves it.
 *
 * A debt is a served paid call whose payment voucher could not be collected
 * for a reason that is not the provider's (a revoked agent key, an expired
 * voucher, a lowered limit). The price is still held in the buyer's escrow,
 * nobody is paid yet, and the payer's PAID calls are refused
 * (`PAYMENT_DEBT_OUTSTANDING`, 402) until it is collected. Free calls still
 * work. Settling is signing a replacement voucher for the same call; a debt
 * left unsettled until `writeOffAt` is written off (the hold is released and
 * the provider is not paid), but it still refuses paid calls until it is
 * signed, and signing it then pays the provider.
 */
export interface BuyerDebt {
  /** The payment intent of the served call — the debt id. */
  intentId: string;
  /** The payer account (CAIP-10) whose escrow owes it. */
  payer: string;
  /** What is owed: the call's price, exactly. */
  amount: Money;
  providerId: string | null;
  toolId: string;
  /** Why the voucher lapsed — the chain refusal (`VoucherExpired`, `DelegateIsRevoked`, …). */
  cause: string | null;
  /** See {@link BuyerDebtState}. */
  state: BuyerDebtState;
  /** When the call FIRST became debt (ISO 8601). A failed replacement does not reset it. */
  lapsedAt: string;
  /** When it is (or was — it may be past) written off if still unsettled (ISO 8601). */
  writeOffAt: string;
  /** `REPLACING` only: when the replacement voucher was accepted (ISO 8601). */
  replacedAt: string | null;
  /** When the call was made (ISO 8601). */
  createdAt: string;
  /**
   * From when it can be settled (ISO 8601): the original voucher must be past
   * its on-chain deadline first, or both could be collected. Before it, the
   * settle routes answer `PAYMENT_DEBT_NOT_YET_REPLACEABLE`. An older backend
   * sends none (settle at once).
   */
  replaceableAt?: string | null;
}

/**
 * Where one debt stands. Every state refuses the payer's paid calls.
 * - `OPEN`: sign the replacement voucher.
 * - `REPLACING`: signed, being collected from the escrow — nothing to do; paid
 *   calls resume once it lands. If the collection fails it is `OPEN` again.
 * - `WRITTEN_OFF`: not settled within 30 days — the hold was released and the
 *   provider was not paid, but paid calls stay refused until it is signed;
 *   signing it then pays the provider.
 */
export type BuyerDebtState = "OPEN" | "REPLACING" | "WRITTEN_OFF";

/**
 * A call's buyer-debt flag on a receipt or a tool-call row.
 * - `OUTSTANDING`: not collected yet (also while a signed replacement is being
 *   collected); the price stays held and paid calls are refused.
 * - `WRITTEN_OFF`: never settled; not charged, provider not paid, and paid
 *   calls stay refused until it is signed.
 * - `VOIDED`: the call failed verification after it had become debt; not
 *   charged, provider not paid.
 */
export type CallDebt = "OUTSTANDING" | "WRITTEN_OFF" | "VOIDED";

/** `GET /escrow/debts`. */
export interface BuyerDebts {
  /** The session's payer account. Only its own debts can be settled from this session. */
  account: string;
  /** Debts that refuse paid calls, in every state, oldest lapse first — the payer account's and the organization's. */
  debts: BuyerDebt[];
}

/** The unsigned replacement voucher, every field chosen by the backend. */
export interface DebtVoucher {
  payer: string;
  payTo: string;
  provider: string;
  amount: Money;
  resource: string;
  requestHash: string;
  seq: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * The backend's EIP-712 request for the voucher: `{ domain, types,
 * primaryType, message }`, integers as decimal strings. It carries no CAIP-2
 * id and no `relayed` flag — the screen supplies the chain it knows.
 */
export interface DebtVoucherTypedData {
  domain: { name: string; version: string; chainId: string; verifyingContract: string; salt?: string };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** `POST /escrow/debts/:intentId/voucher-intent`. */
export interface DebtVoucherIntent {
  debt: BuyerDebt;
  voucher: DebtVoucher;
  /** eip155 only: who may sign — `payer` or `delegate`. */
  signers?: string[];
  delegate?: string | null;
  /** eip155 only; `null` on a chain without a typed-data form. */
  typedData: DebtVoucherTypedData | null;
}

/** Body of `POST /escrow/debts/:intentId/voucher`. */
export interface SettleDebtBody {
  /** The voucher the intent route answered, unchanged. */
  voucher: DebtVoucher;
  signature: string;
}

/** `POST /escrow/debts/:intentId/voucher`. */
export interface SettleDebtResult {
  intentId: string;
  /**
   * The replacement was accepted; the redemption job collects it within about
   * a minute. Paid calls resume once it is collected and no other debt is left.
   */
  status: "REPLACING";
  seq: string;
  /** Debts of this payer still to sign (`OPEN` or `WRITTEN_OFF`). */
  remainingDebts: number;
}

/** `error.context` of `PAYMENT_DEBT_OUTSTANDING` (402). */
export interface DebtOutstandingContext {
  count: number;
  /** The total, formatted by the backend (`"2.50 USDG"`), or null across assets. */
  owed: string | null;
  debts: Omit<BuyerDebt, "createdAt" | "replacedAt" | "replaceableAt">[];
  settleWith: string;
}

export const PAYMENT_DEBT_OUTSTANDING = "PAYMENT_DEBT_OUTSTANDING";
export const PAYMENT_DEBT_NOT_FOUND = "PAYMENT_DEBT_NOT_FOUND";
export const PAYMENT_DEBT_REPLACEMENT_PENDING = "PAYMENT_DEBT_REPLACEMENT_PENDING";
/** 409: the original voucher is still inside its on-chain window; `context.replaceableAt` says until when. */
export const PAYMENT_DEBT_NOT_YET_REPLACEABLE = "PAYMENT_DEBT_NOT_YET_REPLACEABLE";
/** 409: the replacement was refused (the debt changed meanwhile); nothing was changed. */
export const PAYMENT_DEBT_REPLACEMENT_REFUSED = "PAYMENT_DEBT_REPLACEMENT_REFUSED";
