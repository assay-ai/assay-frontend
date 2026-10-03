/**
 * The public wire shape of an unsigned transaction — the backend's three-member
 * discriminated union, mirrored on this side.
 *
 * **Source: assay-backend `src/modules/chains/ports/unsigned-chain-transaction.ts`
 * and the Swagger classes beside it**, field for field. The backend brands
 * `chainId` as `ChainId` with an explicit `type: String` on `@ApiProperty`; a
 * brand does not survive JSON, so it is a plain `string` here.
 *
 * **Three members, and `namespace` alone does not discriminate** — two of the
 * three are `eip155`. `kind` is the second discriminant, and the typed-data
 * member is not optional: several buyer-facing "transactions" on EVM
 * (`setLimitsBySig`, `requestWithdrawBySig`) are SIGNATURE REQUESTS the
 * platform relayer submits. A two-member union would force this frontend to
 * fabricate a transaction it must not send, which is how a chain abstraction
 * rots.
 *
 * `lastValidBlockHeight`, `nonce`, `gasLimit`, `value` and the two fee fields
 * are decimal STRINGS: they are u64/u256 on their chains, and JSON has no such
 * number. Never `Number()` one.
 *
 * **No sync guard.** This is a hand mirror of the backend port file named
 * above (assay-backend). Re-diff it against the real port whenever
 * either side changes — a renamed field surfaces as `undefined` handed to a
 * wallet, not as an error.
 */

/** One field of an EIP-712 struct. */
export interface Eip712Field {
  name: string;
  type: string;
}

/**
 * The EIP-712 domain separator's inputs.
 *
 * `chainId` here is the **EVM** chain id (`"46630"`), not the CAIP-2 id on the
 * request around it (`"eip155:46630"`). They are different strings naming the
 * same network and the domain separator is computed from this one.
 */
export interface Eip712Domain {
  name: string;
  version: string;
  chainId: string;
  verifyingContract: string;
  salt?: string;
}

export type SolanaUnsignedTransaction = {
  readonly namespace: "solana";
  readonly chainId: string;
  readonly kind: "transaction";
  readonly transactionBase64: string;
  readonly feePayer: string;
  readonly signers: readonly string[];
  readonly blockhash: string;
  readonly lastValidBlockHeight: string;
};

export type Eip155UnsignedTransaction = {
  readonly namespace: "eip155";
  readonly chainId: string;
  readonly kind: "transaction";
  readonly from: string;
  readonly to: string;
  readonly data: string;
  readonly value: string;
  readonly nonce: string;
  readonly gasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
};

export type Eip155TypedDataRequest = {
  readonly namespace: "eip155";
  readonly chainId: string;
  readonly kind: "typed-data";
  readonly domain: Eip712Domain;
  readonly types: Record<string, readonly Eip712Field[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
  /**
   * Always `true`, and it is the reason this member exists: the platform's
   * relayer submits the call, so the browser must never look for a
   * transaction to send here.
   */
  readonly relayed: true;
};

export type UnsignedChainTransaction =
  | SolanaUnsignedTransaction
  | Eip155UnsignedTransaction
  | Eip155TypedDataRequest;

export type SignedChainTransaction =
  | { readonly namespace: "solana"; readonly chainId: string; readonly transactionBase64: string }
  | { readonly namespace: "eip155"; readonly chainId: string; readonly rawTransaction: `0x${string}` };

/**
 * Narrows to the one member that carries base64 wire bytes.
 *
 * `namespace`, not `kind`: `kind === "transaction"` is true of the eip155
 * member too, and that member has no `transactionBase64` at all.
 */
export function isSolanaTransaction(tx: UnsignedChainTransaction): tx is SolanaUnsignedTransaction {
  return tx.namespace === "solana";
}

/**
 * Narrows to the relayed signature request.
 *
 * `kind`, not `namespace`: both eip155 members share a namespace and only this
 * one must never be broadcast by the browser.
 */
export function isTypedDataRequest(tx: UnsignedChainTransaction): tx is Eip155TypedDataRequest {
  return tx.kind === "typed-data";
}
