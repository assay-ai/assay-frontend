import type { CursorPage, ListQuery, Money } from "@/interfaces";

import { api } from "./api";

/**
 * Funding: balances, deposits and the buyer-deposit flow.
 *
 * The deposit round trip is three steps and the browser owns the middle one:
 *
 *   1. `POST /deposits` — the backend reserves an intent and answers with
 *      everything needed to build the transfer.
 *   2. the browser builds it (`@/libs/chains/solana/deposit-transaction`) and the
 *      wallet signs it (`@/hooks/useSigner`). The backend holds no buyer key
 *      and cannot do this step.
 *   3. `POST /deposits/:id/settle` — the signed transaction goes back, and the
 *      backend submits and watches it.
 *
 * Withdrawals are requested and claimed through `escrow.service.ts`; their
 * history is `GET /withdrawals` here. There is no auto top-up route.
 */

export interface Deposit {
  id: string;
  status: "CREATED" | "SETTLING" | "SETTLED" | "FAILED" | "EXPIRED";
  statusReason: string | null;
  agentId: string;
  /** CAIP-10. */
  agentAccount: string;
  /** What the `402` requirements advertised. */
  requestedAmount: Money;
  /** What actually landed on chain. `null` until settlement is observed. */
  settledAmount: Money | null;
  /** CAIP-2. */
  chainId: string;
  chainTxRef: string | null;
  expiresAt: string;
  createdAt: string;
  /**
   * `SETTLED` only, else `null`: `PENDING` while the credit waits in the
   * ledger's pending bucket for chain finality, then `CONFIRMED` (available)
   * or `REJECTED` (a reorg dropped it; nothing was added). Absent from an API
   * that predates it.
   */
  finality?: "PENDING" | "CONFIRMED" | "REJECTED" | null;
}

export interface ListDepositsQuery extends ListQuery {
  status?: string[];
  from?: string;
  to?: string;
  search?: string;
}

/**
 * One withdrawal from the escrow (`GET /withdrawals`): a request and what
 * became of it. Read from the chain's withdrawal events past a confirmation
 * depth, so it trails the chain by a few minutes; the live pending request is
 * `GET /escrow`'s `withdrawRequested` / `withdrawAvailableAt`.
 */
export interface Withdrawal {
  id: string;
  /** CAIP-2. */
  chainId: string;
  /** CAIP-10: the escrow it came out of. */
  account: string;
  /** REPLACED: a newer request overwrote it before it was claimed. */
  status: "PENDING" | "CLAIMED" | "CANCELLED" | "REPLACED";
  /** Null for a claim whose request predates the history. */
  requested: Money | null;
  /** What the contract paid: below `requested` if a payment landed during the hour. */
  received: Money | null;
  requestedAt: string | null;
  claimableAt: string | null;
  /** Claimed, cancelled or replaced. */
  closedAt: string | null;
  requestTransactionHash: string | null;
  closeTransactionHash: string | null;
}

/** GET /withdrawals — the "Withdrawals" list on the Funding screen, newest first. */
export function listWithdrawals(): Promise<{ items: Withdrawal[] }> {
  return api.get<{ items: Withdrawal[] }>("/withdrawals");
}

/** How a statement's closing balance compares with the escrow, read now. */
export interface StatementBalanceCheck {
  escrowBalance: Money;
  /** Paid on the statement, not taken from the escrow yet (still being settled). */
  stillSettling: Money;
  /** `escrowBalance − stillSettling − closing`; may be negative. */
  difference: Money;
  matches: boolean;
  observedAt: string;
}

/** One escrow's money for a statement period: opening + deposits − withdrawals − paid = closing. */
export interface StatementBalance {
  account: string;
  chainId: string;
  opening: Money;
  deposits: Money;
  withdrawals: Money;
  paid: Money;
  closing: Money;
  /** Only for a period that has not ended; null otherwise or when the chain could not be read. */
  check: StatementBalanceCheck | null;
}

/** GET /statements/balance — the money half of a monthly statement, per escrow. Derived; never stored. */
export function getStatementBalance(query: { from: string; to: string }): Promise<{ items: StatementBalance[] }> {
  return api.get<{ items: StatementBalance[] }>("/statements/balance", query);
}

/** GET /deposits/:depositId — one deposit of this organization (404 for anyone else's). */
export function getDeposit(depositId: string): Promise<Deposit> {
  return api.get<Deposit>(`/deposits/${encodeURIComponent(depositId)}`);
}

/** GET /deposits — the "Deposits" table on the Funding screen. */
export function listDeposits(query: ListDepositsQuery = {}): Promise<CursorPage<Deposit>> {
  return api.get<CursorPage<Deposit>>("/deposits", query as Record<string, unknown>);
}

/**
 * What `POST /deposits` hands back to build the transfer with.
 *
 * These are the x402 `PaymentRequirements` in chain-native form — `payTo` is
 * the vault's associated token account and `asset` is the bare mint, neither
 * of them CAIP-10/CAIP-19 — plus **two fields that deliberately do not ride on
 * `PaymentRequirements` at all**: `blockhash` and `lastValidBlockHeight`. They
 * are not part of the payment's terms; they are the lifetime of the one
 * transaction about to be signed, and the wallet needs a blockhash it did not
 * fetch itself so that what the backend verifies is what the user signed.
 *
 * `memo` is the deposit id. It is what ties the on-chain transfer back to the
 * intent, so it is not decorative and must be copied through verbatim.
 */
export type DepositRequirements = SolanaDepositRequirements | EvmDepositRequirements;

/**
 * The `eip155` member: a **contract call**, not a transfer, and deliberately no
 * destination address — assay-backend `…/create-deposit.dto.ts`
 * `EvmDepositRequirementsDto`, field for field.
 *
 * `approve(spender, amount)` on `asset`, then `depositFor(buyer, amount)` on
 * `contract`. `plainTransferCreditsNobody` is on the wire so the one fact that
 * can lose a buyer's money travels with the data: a bare ERC-20 transfer into
 * `contract` credits nobody and has no remedy. Never render `contract` as an
 * address to send to.
 */
export interface EvmDepositRequirements {
  namespace: "eip155";
  /** CAIP-2. */
  chainId: string;
  /** The pooled escrow — the contract `depositFor` is called on. */
  contract: string;
  method: "depositFor(address,uint64)";
  /** Who `approve` authorises. The escrow itself today; read, never assumed. */
  spender: string;
  /** The account credited — must be the wallet that signs (the contract pulls from it). */
  buyer: string;
  /** The settlement token (ERC-20), chain-native, not CAIP-19. */
  asset: string;
  /** Atomic units, decimal string. */
  amount: string;
  decimals: number;
  plainTransferCreditsNobody: true;
}

export function isEvmDepositRequirements(
  requirements: DepositRequirements,
): requirements is EvmDepositRequirements {
  return requirements.namespace === "eip155";
}

export interface SolanaDepositRequirements {
  /**
   * The discriminant. Every reader of this type has to say which member it
   * handles instead of assuming SPL.
   */
  namespace: "solana";
  /** CAIP-2. */
  chainId: string;
  /**
   * The buyer's own escrow associated token account — chain-native, not
   * CAIP-10.
   *
   * This is the one line in this file that can lose a buyer's
   * money: **on EVM a bare transfer to the pooled escrow contract credits
   * nobody.** So `payTo` is never rendered as "an address you can send to" —
   * it is an input to a transaction this app builds, and the deposit screen
   * must never offer it as a manual transfer target.
   */
  payTo: string;
  /** The bare mint address — chain-native, not CAIP-19. */
  asset: string;
  /** Atomic units, decimal string. */
  amount: string;
  decimals: number;
  /** The facilitator pays the fee; the buyer signs without holding SOL. */
  feePayer: string;
  /** Equals the `depositId` — the on-chain link back to this intent. */
  memo: string;
  blockhash: string;
  /**
   * A u64, so it arrives as a **decimal string** and stays one here.
   * `BigInt()` it at the `buildDepositTransaction` call site — converting it
   * in this layer would put a `bigint` into a value React state and JSON both
   * have to carry, and JSON cannot serialise one.
   */
  lastValidBlockHeight: string;
}

export interface CreatedDeposit {
  depositId: string;
  /** After this, settle is refused and the intent has to be re-created. */
  expiresAt: string;
  requirements: DepositRequirements;
}

/**
 * What `POST /deposits/:id/settle` answers with. Narrower than `Deposit` on
 * purpose — the settle route reports the outcome, not the whole row.
 *
 * `status` reuses `Deposit`'s union rather than restating it: a status added
 * on one side and not the other is exactly the kind of drift a screen
 * discovers by rendering nothing.
 */
export interface SettledDeposit {
  id: string;
  status: Deposit["status"];
  /** `null` until the chain confirms — which is not the same as zero. */
  settledAmount: Money | null;
  chainTxRef: string | null;
}

/**
 * `POST /deposits` — reserve a deposit intent and get the requirements.
 *
 * `amount` is **atomic units as a decimal string**, matching `/^[1-9][0-9]*$/`:
 * no decimal point, no leading zero, no sign, and never a `number`. A USDC
 * balance in atomic units passes `Number.MAX_SAFE_INTEGER` at about 9 billion
 * dollars, and the string is what keeps the conversion from ever happening.
 *
 * ## `chainId` is sent on every request, always
 *
 * The backend requires it only for a buyer with two linked
 * accounts, so a one-chain deployment would accept its absence and infer.
 * Sending it anyway means the chain a person read on screen is the chain in
 * the request — and the day a second account appears, nothing on this side has
 * to change or be remembered. Both ends of this call are therefore stricter
 * than the wire contract requires.
 *
 * Two refusals live on this field: `PAYMENT_DEPOSIT_CHAIN_REQUIRED` (400) when
 * a two-account buyer sends none, and `PAYMENT_DEPOSIT_ACCOUNT_NOT_LINKED`
 * (409) for a chain this buyer has no account on — which is also where a
 * malformed CAIP-2 id lands, deliberately, so that "you cannot deposit on
 * that" has one spelling rather than three.
 */
export function createDeposit(amount: string, chainId: string): Promise<CreatedDeposit> {
  return api.post<CreatedDeposit>("/deposits", { amount, chainId });
}

/**
 * `POST /deposits/:depositId/settle` — hand the signed transaction back.
 *
 * The caller passes the chain and the base64 transaction. `x402Version` and
 * `scheme` are protocol constants and are still built here, so there is one
 * place to change them rather than one per screen.
 *
 * **`network` is not a constant and must never become one again.** It was the
 * module constant `SOLANA_DEVNET_CAIP2`. On a two-chain deployment that is not
 * a validation error — it is a signature declared against the wrong network,
 * which the facilitator checks against the chain the envelope names, so the
 * failure is a valid signature over the wrong thing. It now comes from the
 * intent that was created, which is the chain the buyer chose and the chain
 * the transaction was built for.
 *
 * Answers **201**, not 200 — Nest's default for `@Post`, and settle really does
 * create the settlement attempt.
 */
export function settleDeposit(
  depositId: string,
  chainId: string,
  /** base64 on `solana`; the `0x` signed, serialized transaction on `eip155`. */
  transactionBase64: string,
): Promise<SettledDeposit> {
  return api.post<SettledDeposit>(`/deposits/${depositId}/settle`, {
    x402Version: 2,
    scheme: "exact",
    network: chainId,
    payload: { transaction: transactionBase64 },
  });
}

/**
 * `POST /deposits/:depositId/broadcast` — an injected wallet (MetaMask,
 * Rabby, …) SENT the `depositFor` itself, and this reports its hash. The
 * backend reads the transaction off the chain; it credits only an escrow
 * `Deposited` event for this intent's buyer, for at least the requested
 * amount, and refuses a hash another deposit already claimed.
 */
export function settleDepositByBroadcast(
  depositId: string,
  transactionHash: string,
): Promise<SettledDeposit> {
  return api.post<SettledDeposit>(`/deposits/${depositId}/broadcast`, { transactionHash });
}
