import type { Money } from "./api";

/**
 * Buyer debt, as assay-backend `payment/dto/buyer-debt.dto.ts` serves it.
 *
 * A debt is a served paid call whose payment voucher could not be collected
 * for a reason that is not the provider's (a revoked agent key, an expired
 * voucher, a lowered limit). The price is still held in the buyer's escrow,
 * nobody is paid yet, and the payer's PAID calls are refused
 * (`PAYMENT_DEBT_OUTSTANDING`, 402) until it is settled. Free calls still work.
 * Settling is signing a replacement voucher for the same call; a debt left
 * unsettled until `writeOffAt` is written off and the provider is not paid.
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
  /** When the call became debt (ISO 8601). */
  lapsedAt: string;
  /** When it is written off if still unsettled (ISO 8601). */
  writeOffAt: string;
  /** When the call was made (ISO 8601). */
  createdAt: string;
}

/** `GET /escrow/debts`. */
export interface BuyerDebts {
  /** The session's payer account. Only its own debts can be settled from this session. */
  account: string;
  /** Open debts, oldest first — the payer account's and the organization's. */
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
  /** The replacement was accepted; the redemption job collects it within about a minute. */
  status: "REPLACED";
  seq: string;
  /** Open debts left for this payer. Paid calls work again at zero. */
  remainingDebts: number;
}

/** `error.context` of `PAYMENT_DEBT_OUTSTANDING` (402). */
export interface DebtOutstandingContext {
  count: number;
  /** The total, formatted by the backend (`"2.50 USDG"`), or null across assets. */
  owed: string | null;
  debts: Omit<BuyerDebt, "createdAt">[];
  settleWith: string;
}

export const PAYMENT_DEBT_OUTSTANDING = "PAYMENT_DEBT_OUTSTANDING";
export const PAYMENT_DEBT_NOT_FOUND = "PAYMENT_DEBT_NOT_FOUND";
