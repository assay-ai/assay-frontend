import { assertRequirementsChain } from "@/features/funding/deposit-chain";
import { approveEvmDeposit, checkEvmDeposit, sendEvmDepositFor } from "@/features/funding/evm-deposit";
import type { Signer } from "@/hooks/useSigner";
import { ApiError } from "@/libs/ApiClient";
import { waitForSuccess } from "@/libs/chains/evm/deposit-transaction";
import { toBase64 } from "@/libs/chains/solana/base64";
import { buildDepositTransaction } from "@/libs/chains/solana/deposit-transaction";
import {
  createDeposit,
  isEvmDepositRequirements,
  settleDeposit,
  settleDepositByBroadcast,
  type CreatedDeposit,
  type SettledDeposit,
} from "@/services/funding.service";

/**
 * The deposit as two wallet steps, so SignAction can show "Approve → Deposit":
 *
 *   approve: POST /deposits (opens a 120 s intent) → checks → approve() if
 *            the allowance is short (no prompt when it is not);
 *   deposit: depositFor() → settle (embedded: signed bytes; injected: by hash).
 *
 * The intent is minted inside the first step, right before the wallet, never
 * on mount. If the approval took long, the deposit step mints a fresh intent:
 * the allowance is on chain and does not expire with it.
 */
export const INTENT_FRESH_MS = 90_000;

export interface DepositRun {
  chainId: string;
  amountAtomic: string;
  created: CreatedDeposit | null;
  createdAt: number;
  nativeWei?: bigint;
}

async function freshIntent(run: DepositRun): Promise<CreatedDeposit> {
  if (run.created && Date.now() - run.createdAt < INTENT_FRESH_MS) return run.created;
  const created = await createDeposit(run.amountAtomic, run.chainId);
  assertRequirementsChain(run.chainId, created.requirements.chainId);
  run.created = created;
  run.createdAt = Date.now();
  return created;
}

/** Step 1 on EVM. Resolves without a prompt when the allowance already covers the amount. */
export async function runApproveStep(
  run: DepositRun,
  signer: Signer,
  onSubmitted: (hash: `0x${string}`) => void,
  previousHash?: `0x${string}`,
): Promise<void> {
  if (previousHash) {
    await waitForSuccess(run.chainId, previousHash);
    return;
  }
  const created = await freshIntent(run);
  if (!isEvmDepositRequirements(created.requirements)) return;
  const amountAtomic = BigInt(run.amountAtomic);
  const check = await checkEvmDeposit({ signer, requirements: created.requirements, amountAtomic });
  run.nativeWei = check.nativeWei;
  if (!check.needsApprove) return;
  run.nativeWei = await approveEvmDeposit({
    signer,
    requirements: created.requirements,
    amountAtomic,
    nativeWei: check.nativeWei,
    onSubmitted,
  });
}

/** Credits a deposit the wallet itself broadcast; an expired intent is replaced, one hash credits once. */
export async function settleByHash(
  run: Pick<DepositRun, "chainId" | "amountAtomic">,
  depositId: string,
  hash: string,
): Promise<SettledDeposit | "already-credited"> {
  try {
    return await settleDepositByBroadcast(depositId, hash);
  } catch (caught) {
    if (isAlreadyClaimed(caught)) return "already-credited";
    if (!(caught instanceof ApiError) || caught.code !== "PAYMENT_DEPOSIT_EXPIRED") throw caught;
    const fresh = await createDeposit(run.amountAtomic, run.chainId);
    try {
      return await settleDepositByBroadcast(fresh.depositId, hash);
    } catch (again) {
      if (isAlreadyClaimed(again)) return "already-credited";
      throw again;
    }
  }
}

/** The hash was credited already (by this page, another tab, or a retry): the job is done. */
export function isAlreadyClaimed(error: unknown): boolean {
  return error instanceof ApiError && /ALREADY_(CLAIMED|SETTLED|CREDITED)/.test(error.code);
}

/** What a submitted deposit step hands back to a retry, so it never signs twice. */
export type DepositAttempt =
  | { kind: "hash"; hash: `0x${string}`; depositId: string }
  | { kind: "signed"; raw: `0x${string}`; depositId: string };

/** Step 2 (EVM), or the only step (Solana). */
export async function runDepositStep(
  run: DepositRun,
  signer: Signer,
  hooks: {
    onWallet: () => void;
    /** A transaction the wallet broadcast itself (injected wallet). */
    onSubmitted: (hash: `0x${string}`, depositId: string) => void;
    /** Signed bytes about to be handed to the settle route (embedded wallet). */
    onSigned?: (attempt: DepositAttempt) => void;
    previous?: DepositAttempt;
  },
): Promise<SettledDeposit | "already-credited"> {
  // A retry after submission re-checks what was sent instead of signing again.
  if (hooks.previous?.kind === "hash") {
    await waitForSuccess(run.chainId, hooks.previous.hash);
    return settleByHash(run, hooks.previous.depositId, hooks.previous.hash);
  }
  if (hooks.previous?.kind === "signed") {
    try {
      return await settleDeposit(hooks.previous.depositId, run.chainId, hooks.previous.raw);
    } catch (error) {
      if (isAlreadyClaimed(error)) return "already-credited";
      throw error;
    }
  }
  const created = await freshIntent(run);
  const requirements = created.requirements;
  if (isEvmDepositRequirements(requirements)) {
    hooks.onWallet();
    const submission = await sendEvmDepositFor({
      signer,
      requirements,
      amountAtomic: BigInt(run.amountAtomic),
      nativeWei: run.nativeWei,
      onSubmitted: (hash) => hooks.onSubmitted(hash, created.depositId),
    });
    if (submission.kind === "signed") {
      hooks.onSigned?.({ kind: "signed", raw: submission.rawTransaction, depositId: created.depositId });
      return settleDeposit(created.depositId, run.chainId, submission.rawTransaction);
    }
    return settleByHash(run, created.depositId, submission.transactionHash);
  }

  const { transactionBytes } = await buildDepositTransaction({
    owner: signer.address,
    escrowAta: requirements.payTo,
    mint: requirements.asset,
    decimals: requirements.decimals,
    amountAtomic: BigInt(run.amountAtomic),
    feePayer: requirements.feePayer,
    memo: requirements.memo,
    blockhash: requirements.blockhash,
    lastValidBlockHeight: BigInt(requirements.lastValidBlockHeight),
  });
  hooks.onWallet();
  const signed = await signer.signTransaction({
    namespace: "solana",
    chainId: run.chainId,
    kind: "transaction",
    transactionBase64: toBase64(transactionBytes),
    feePayer: requirements.feePayer,
    signers: [signer.address],
    blockhash: requirements.blockhash,
    lastValidBlockHeight: requirements.lastValidBlockHeight,
  });
  if (signed.namespace !== "solana") throw new Error(`Expected a Solana signature, got ${signed.namespace}.`);
  return settleDeposit(created.depositId, run.chainId, signed.transactionBase64);
}
