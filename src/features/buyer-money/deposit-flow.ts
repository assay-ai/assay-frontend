import { assertRequirementsChain } from "@/features/funding/deposit-chain";
import { approveEvmDeposit, checkEvmDeposit, sendEvmDepositFor } from "@/features/funding/evm-deposit";
import type { Signer } from "@/hooks/useSigner";
import { ApiError, warmSessionToken } from "@/libs/ApiClient";
import { waitForSuccess } from "@/libs/chains/evm/deposit-transaction";
import { toBase64 } from "@/libs/chains/solana/base64";
import { buildDepositTransaction } from "@/libs/chains/solana/deposit-transaction";
import {
  createDeposit,
  getDeposit,
  isEvmDepositRequirements,
  settleDeposit,
  settleDepositByBroadcast,
  type CreatedDeposit,
  type Deposit,
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

/**
 * A request that got no readable answer: the axios timeout ("timeout of
 * 30000ms exceeded"), a dropped connection, or a response the browser could
 * not read ("Failed to fetch"). The server may still have done the work.
 */
export function isNoAnswer(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status !== 0) return false;
    return (
      ["ECONNABORTED", "ETIMEDOUT", "ERR_NETWORK", "NETWORK_ERROR", "ECONNRESET"].includes(error.code) ||
      /timeout of \d+ms exceeded|network error|failed to fetch/i.test(error.message)
    );
  }
  return error instanceof TypeError && /failed to fetch|network/i.test(error.message);
}

/** Before anything was signed: Assay did not answer in time. Its message is shown as is. */
export class DepositNoAnswer extends Error {
  constructor() {
    super("Assay took too long to answer. Nothing was signed or sent. Try again.");
    this.name = "DepositNoAnswer";
  }
}

/**
 * After the transaction was signed or sent, the settle answer was lost and
 * re-reading the deposit did not settle it either way. Not a failure: the
 * deposit may still land. Its message is shown as is.
 */
export class DepositStillChecking extends Error {
  constructor() {
    super(
      "Your deposit was sent and we are still checking it. Watch Funding for it; Try again checks it rather than sending it twice.",
    );
    this.name = "DepositStillChecking";
  }
}

/** Pauses between re-reads of a deposit whose settle answer was lost (~26 s, past the backend's ~20 s chain wait). */
export const RECHECK_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 12_000];

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function asSettled(deposit: Deposit): SettledDeposit {
  return {
    id: deposit.id,
    status: deposit.status,
    settledAmount: deposit.settledAmount,
    chainTxRef: deposit.chainTxRef,
  };
}

function notObserved(deposit: Deposit): ApiError {
  return new ApiError(
    "PAYMENT_DEPOSIT_TRANSFER_NOT_OBSERVED",
    deposit.statusReason ?? "No transfer was observed for this deposit.",
    422,
  );
}

/** `null` when the deposit could not be read. */
async function readDeposit(depositId: string): Promise<Deposit | null> {
  try {
    return await getDeposit(depositId);
  } catch {
    return null;
  }
}

/**
 * Re-reads a deposit whose settle answer was lost, a few times with a short
 * backoff. Only ever a GET: a payload that may have landed is never sent
 * again (the backend refuses a second settle of a `SETTLING` intent anyway).
 *
 * SETTLED → the deposit; FAILED → not observed; still CREATED / SETTLING or
 * unreadable at the end → `DepositStillChecking`.
 */
export async function recheckDeposit(depositId: string): Promise<SettledDeposit> {
  for (const delay of RECHECK_DELAYS_MS) {
    await pause(delay);
    const deposit = await readDeposit(depositId);
    if (deposit?.status === "SETTLED") return asSettled(deposit);
    if (deposit?.status === "FAILED") throw notObserved(deposit);
    if (deposit?.status === "EXPIRED") {
      throw new ApiError("PAYMENT_DEPOSIT_EXPIRED", deposit.statusReason ?? "The deposit expired.", 409);
    }
  }
  throw new DepositStillChecking();
}

/** One settle request; a lost answer is resolved by re-reading the deposit, never by sending again. */
async function settleOrRecheck<T>(depositId: string, send: () => Promise<T>): Promise<T | SettledDeposit> {
  try {
    return await send();
  } catch (error) {
    if (!isNoAnswer(error)) throw error;
    return recheckDeposit(depositId);
  }
}

/**
 * A retry of a submitted deposit step reads where the intent stands first.
 * Returns the outcome when it is known (or still settling, re-read until it
 * is), else the status of an intent that never settled:
 *
 * - `CREATED` — nothing reached the chain through it; the same payload may go back.
 * - `EXPIRED` — reachable only from CREATED, so its payload was never broadcast by us.
 * - `FAILED` — the backend watched the chain and saw no transfer. It stores no
 *   `chainTxRef`, so the same hash can still be claimed by a fresh intent once
 *   it lands (the backend credits one hash once: `findByChainTxRef` and
 *   `uq_ledger_entries_deposit_pending`).
 */
async function outcomeBeforeRetry(
  depositId: string,
): Promise<SettledDeposit | { unsettled: "CREATED" | "EXPIRED" | "FAILED"; deposit: Deposit }> {
  let deposit: Deposit;
  try {
    deposit = await getDeposit(depositId);
  } catch (error) {
    if (isNoAnswer(error)) throw new DepositStillChecking();
    throw error;
  }
  if (deposit.status === "SETTLED") return asSettled(deposit);
  if (deposit.status === "SETTLING") return recheckDeposit(depositId);
  return { unsettled: deposit.status, deposit };
}

/** The longest a warm-up may hold the click before the intent is created anyway. */
export const WARM_UP_LIMIT_MS = 30_000;

/**
 * Gets the session and the wallet ready before anything starts the intent's
 * clock. On a cold tab the Privy embedded-wallet session refresh took tens of
 * seconds before the first prompt, all of it inside the intent's lifetime
 * (BUG-PROD-DEPOSIT-01). Called when the drawer opens and again at the start
 * of the click (a no-op by then). Never throws, and gives up after
 * `WARM_UP_LIMIT_MS`: the wallet step reports any real problem itself.
 */
export async function warmWallet(signer: Signer | null | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, WARM_UP_LIMIT_MS);
  });
  const warm = Promise.allSettled([warmSessionToken(), signer?.prepare?.()]).then(() => undefined);
  try {
    await Promise.race([warm, limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function freshIntent(run: DepositRun, signer: Signer): Promise<CreatedDeposit> {
  if (run.created && Date.now() - run.createdAt < INTENT_FRESH_MS) return run.created;
  // The wallet first, then the intent: its lifetime starts with POST /deposits.
  await warmWallet(signer);
  let created: CreatedDeposit;
  try {
    created = await createDeposit(run.amountAtomic, run.chainId);
  } catch (error) {
    if (isNoAnswer(error)) throw new DepositNoAnswer();
    throw error;
  }
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
  const created = await freshIntent(run, signer);
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

/** Reports `hash` on a new intent; `onReplaced` names it, so a later retry checks that one. */
async function settleHashOnFreshIntent(
  run: Pick<DepositRun, "chainId" | "amountAtomic">,
  hash: string,
  onReplaced?: (depositId: string) => void,
): Promise<SettledDeposit | "already-credited"> {
  const fresh = await createDeposit(run.amountAtomic, run.chainId);
  onReplaced?.(fresh.depositId);
  try {
    return await settleOrRecheck(fresh.depositId, () => settleDepositByBroadcast(fresh.depositId, hash));
  } catch (again) {
    if (isAlreadyClaimed(again)) return "already-credited";
    throw again;
  }
}

/** Credits a deposit the wallet itself broadcast; an expired intent is replaced, one hash credits once. */
export async function settleByHash(
  run: Pick<DepositRun, "chainId" | "amountAtomic">,
  depositId: string,
  hash: string,
  onReplaced?: (depositId: string) => void,
): Promise<SettledDeposit | "already-credited"> {
  try {
    return await settleOrRecheck(depositId, () => settleDepositByBroadcast(depositId, hash));
  } catch (caught) {
    if (isAlreadyClaimed(caught)) return "already-credited";
    if (!(caught instanceof ApiError) || caught.code !== "PAYMENT_DEPOSIT_EXPIRED") throw caught;
    return settleHashOnFreshIntent(run, hash, onReplaced);
  }
}

/** The hash was credited already (by this page, another tab, or a retry): the job is done. */
export function isAlreadyClaimed(error: unknown): boolean {
  return error instanceof ApiError && /ALREADY_(CLAIMED|SETTLED|CREDITED)/.test(error.code);
}

/** What a submitted deposit step hands back to a retry, so it never signs twice. */
export type DepositAttempt =
  | { kind: "hash"; hash: `0x${string}`; depositId: string }
  /** `raw`: the `0x` signed transaction on eip155, base64 on solana. */
  | { kind: "signed"; raw: string; depositId: string };

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
  // A retry after submission re-checks what was sent instead of signing again:
  // where the intent stands first, and the same payload again only when it
  // was never settled.
  if (hooks.previous?.kind === "hash") {
    const { depositId, hash } = hooks.previous;
    const read = await outcomeBeforeRetry(depositId);
    if (!("unsettled" in read)) return read;
    await waitForSuccess(run.chainId, hash);
    // The wallet's own transaction is mined. An EXPIRED or FAILED intent can no
    // longer take it, but a fresh one can (one hash credits once).
    if (read.unsettled !== "CREATED") {
      return settleHashOnFreshIntent(run, hash, (id) => hooks.onSubmitted(hash, id));
    }
    return settleByHash(run, depositId, hash, (id) => hooks.onSubmitted(hash, id));
  }
  if (hooks.previous?.kind === "signed") {
    const { depositId, raw } = hooks.previous;
    const read = await outcomeBeforeRetry(depositId);
    if (!("unsettled" in read)) return read;
    if (read.unsettled === "FAILED") throw notObserved(read.deposit);
    if (read.unsettled === "CREATED") {
      try {
        return await settleOrRecheck(depositId, () => settleDeposit(depositId, run.chainId, raw));
      } catch (error) {
        if (isAlreadyClaimed(error)) return "already-credited";
        throw error;
      }
    }
    // EXPIRED: reachable only from CREATED, so these bytes were never handed
    // to the chain. They cannot settle any more; sign afresh on a new intent.
    run.created = null;
  }
  const created = await freshIntent(run, signer);
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
      return settleOrRecheck(created.depositId, () =>
        settleDeposit(created.depositId, run.chainId, submission.rawTransaction),
      );
    }
    const hash = submission.transactionHash;
    return settleByHash(run, created.depositId, hash, (id) => hooks.onSubmitted(hash, id));
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
  }, { showWalletUIs: true });
  if (signed.namespace !== "solana") throw new Error(`Expected a Solana signature, got ${signed.namespace}.`);
  // Reported like the eip155 signed bytes: a retry re-reads this intent and
  // never signs a second transfer for a payload that may have landed.
  hooks.onSigned?.({ kind: "signed", raw: signed.transactionBase64, depositId: created.depositId });
  return settleOrRecheck(created.depositId, () => settleDeposit(created.depositId, run.chainId, signed.transactionBase64));
}
