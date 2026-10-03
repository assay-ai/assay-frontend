/**
 * @fileoverview
 * Builds an x402 `exact` deposit transaction in the browser, exactly as a real
 * client would: ComputeBudget limit, ComputeBudget price, `TransferChecked`
 * (user ATA -> escrow ATA), SPL Memo = deposit intent id, an empty unsigned fee
 * payer slot for the facilitator to fill in.
 *
 * A mirror of assay-backend `scripts/devnet/lib/build-deposit-payload.ts` — the only
 * shape that has ever run for real. Three differences, all three required:
 *
 *  1. **No keypair.** The script signs immediately with
 *     `partiallySignTransaction`; here the wallet is what signs, so this
 *     function stops at `compileTransaction` and returns bytes.
 *  2. **`createNoopSigner` instead of `KeyPairSigner`.** Passing a bare
 *     `Address` for `authority` makes codama assign the READONLY role,
 *     `compileTransaction` then produces only ONE signature slot (the fee
 *     payer), and the wallet has nowhere to sign. No error, no warning — just
 *     a wrong transaction. `createNoopSigner` exists only to set the correct
 *     role; its `signTransactions` function is never called.
 *  3. **No RPC call.** The blockhash is a parameter. The browser has no RPC
 *     URL, and that is deliberate: a keyed RPC endpoint carries an
 *     API key, and `NEXT_PUBLIC_*` means it lands in the JS bundle anyone can
 *     read. The backend supplies the blockhash together with the `402`
 *     requirements.
 *
 * **Legacy, not v0.** Kora 1.0.3 deserializes with
 * `bincode::deserialize::<solana_sdk::transaction::Transaction>`, legacy only;
 * a v0 message would pass our `/verify` and only die inside Kora. This is
 * Kora's current deserializer, not a protocol constraint — whoever upgrades
 * Kora's version should re-check v0 support before "modernizing" this.
 */

import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getAddMemoInstruction } from "@solana-program/memo";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

/** Both constants have already paid their price on devnet — see `deposit-transaction.test.ts`. */
export const DEPOSIT_COMPUTE_UNIT_LIMIT = 30_000;
/**
 * `1_000` microLamports/CU was rejected by the facilitator with
 * `invalid_exact_svm_payload_compute_budget`; `1` is accepted. Kept at the
 * minimum deliberately — a deposit has no reason to pay a priority fee.
 */
export const DEPOSIT_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1n;

// Reused across calls instead of constructed per invocation — the encoder carries
// no per-call state, so there's nothing to gain from rebuilding it every time.
const transactionEncoder = getTransactionEncoder();

export interface BuildDepositTransactionInput {
  /**
   * The user's wallet — both the source ATA's owner and the TransferChecked
   * authority. Not the fee payer: see `feePayer` below, and the module doc for
   * why the two are different accounts.
   */
  readonly owner: string;
  /** `requirements.payTo` — the escrow's ATA, already derived by the adapter. */
  readonly escrowAta: string;
  /** `requirements.asset` — the mint, in chain-native form. */
  readonly mint: string;
  readonly decimals: number;
  readonly amountAtomic: bigint;
  /** `requirements.extra.feePayer`. */
  readonly feePayer: string;
  /** `requirements.extra.memo` — the deposit intent id. This is what binds the money to the intent. */
  readonly memo: string;
  readonly blockhash: string;
  /** Required by kit's lifetime type; it has no effect on the compiled bytes. */
  readonly lastValidBlockHeight: bigint;
}

export interface BuiltDepositTransaction {
  /** The serialized legacy transaction, not yet signed by anyone. Hand it straight to `useSigner`. */
  readonly transactionBytes: Uint8Array;
  /** The user's ATA, derived here. Useful for showing a "no ATA yet" error. */
  readonly ownerAta: string;
}

export async function buildDepositTransaction(
  input: BuildDepositTransactionInput,
): Promise<BuiltDepositTransaction> {
  if (input.memo.length === 0) {
    // The memo is what binds these lamports to this exact intent (see the module
    // doc). A transfer with no memo can't be reconciled back to an intent, and
    // that failure would only surface much later — so refuse it here, loudly,
    // instead of building a transaction reconciliation can never match.
    throw new Error("buildDepositTransaction: memo must not be empty");
  }
  if (input.amountAtomic === 0n) {
    // A zero-amount transfer is never what a deposit means; catch it here rather
    // than let it build silently and fail as a confusing on-chain no-op later.
    throw new Error("buildDepositTransaction: amountAtomic must be greater than zero");
  }

  const owner = address(input.owner);
  const mint = address(input.mint);

  // Token-2022 mints derive a different ATA under a different token program;
  // this assumes classic SPL Token, which is correct for the MVP's asset
  // registry but would silently derive the wrong ATA for a Token-2022 mint.
  const [ownerAta] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const instructions = [
    getSetComputeUnitLimitInstruction({ units: DEPOSIT_COMPUTE_UNIT_LIMIT }),
    getSetComputeUnitPriceInstruction({
      microLamports: DEPOSIT_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
    }),
    getTransferCheckedInstruction({
      source: ownerAta,
      mint,
      destination: address(input.escrowAta),
      authority: createNoopSigner(owner),
      amount: input.amountAtomic,
      decimals: input.decimals,
    }),
    getAddMemoInstruction({ memo: input.memo }),
  ];

  /*
    `pipe()`, not sequential reassignment into a `let`: each kit builder returns
    a more refined type (adding fee payer, then lifetime, then instructions), and
    reassigning into a `let` variable only compiles against that variable's
    FIRST inferred type. `pipe` threads the value through without having to name
    any intermediate type.
  */
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayer(address(input.feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          // Validated, not cast: this is the least-trusted input in the module — it
          // arrives over the wire in the backend's `402` response — and a wrong
          // length or an empty string passes a bare `as Blockhash` cast silently,
          // only to fail as "Blockhash not found" after Privy has already prompted
          // and the user has already signed. `blockhash()` throws here instead,
          // before any of that happens.
          blockhash: blockhash(input.blockhash),
          lastValidBlockHeight: input.lastValidBlockHeight,
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  return {
    // `compileTransaction` returns a `ReadonlyUint8Array`; the encoder's output type
    // doesn't widen to plain `Uint8Array` on its own, so this cast is the standard
    // workaround, not a hidden narrowing.
    transactionBytes: transactionEncoder.encode(compileTransaction(message)) as Uint8Array,
    ownerAta,
  };
}
