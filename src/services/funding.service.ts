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
 * What is still NOT here, because the API has no route for it:
 *
 *   - reading or writing auto top-up (no route at all)
 *   - requesting a withdrawal        (no POST /withdrawals)
 *
 * Those two screens are therefore built against local state and the real
 * balance, and they stop at the point where the write would happen.
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
}

export interface ListDepositsQuery extends ListQuery {
  status?: string[];
  from?: string;
  to?: string;
  search?: string;
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
   *
   * **Optional, because older backend deployments omit it.** The current
   * backend's `SolanaDepositRequirementsDto` declares `namespace` and `chainId`
   * as required, but earlier versions serve a flat shape with neither. Typing
   * them as required here would assert a field that can arrive `undefined`.
   * Narrow at the boundary — `assertRequirementsChain` — rather than accepting
   * both shapes forever; once every deployment serves the new shape, both
   * fields become required and that guard becomes total.
   */
  namespace?: "solana";
  /** CAIP-2. Optional for the same reason as `namespace`. */
  chainId?: string;
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
