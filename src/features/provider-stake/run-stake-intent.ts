/**
 * @fileoverview
 * The two beats every stake intent shares, written once.
 *
 * `POST /providers/me/stake/intents` answers all four kinds — `OPEN_STAKE`,
 * `DEPOSIT`, `UNSTAKE`, `WITHDRAW` — with the same envelope, and the browser
 * does the same two things with each: refuse an intent that carries no
 * transaction, and hand the rest to the wallet. Opening a stake account and
 * funding it are two calls in a row on the capital screen; without this they
 * would be two copies of the same sequence, and a fix applied to one of them.
 *
 * **It used to be four beats.** Decoding the base64 and deriving the chain id
 * from the CAIP-10 account both moved: the wire's `UnsignedChainTransaction` names
 * its own chain and carries its own encoding, and `useSigner`'s signer
 * is bound to one chain and refuses a payload for another by name. That is
 * strictly stronger than the old `caip2Of(intent.account)`, whose only check
 * was that the string had three segments — it never compared the chain the
 * transaction was built for against the chain the wallet was told.
 *
 * **The browser broadcasts, and that is a design decision, not a shortcut.**
 * The backend builds these transactions unsigned and has nowhere to hand a
 * signed one back: `stake-intent-builder.port.ts:20-21` has no `send`, no
 * `submit` and no `signature` anywhere in its surface, and
 * `stake-intent-builder.service.ts:112` says there is no `sendTransaction` in
 * that file and there must never be one. So `Signer.signAndSend` is the only
 * path on chain — see `hooks/useSigner.ts` for why that needs no RPC URL of
 * its own.
 */

import type { Signer } from "@/hooks/useSigner";
import type { Eip155UnsignedTransaction } from "@/interfaces/chain-transaction";
import type { StakeIntent } from "@/interfaces/provider-stake";
import {
  broadcastAndWait,
  encodeApprove,
  fillTransaction,
  readDepositReadiness,
  waitForSuccess,
} from "@/libs/chains/evm/deposit-transaction";

/**
 * The CAIP-2 chain id out of a CAIP-10 account (`solana:<genesis>:<address>`).
 *
 * **No endpoint publishes the deployment's chain id** — the exit screen's own
 * chain field says so in its hint, and seeds itself from a CAIP-10 payout
 * address the same way. `StakeIntent.account` is the better source still: the
 * backend documents it as *"never taken from the request"*, so it names the
 * chain the transaction was actually built for.
 *
 * Throws on anything that is not CAIP-10. There is no sensible fallback — a
 * guessed chain id reaches `toSolanaChain`, and the guess that would be
 * cheapest to write is the one that broadcasts a devnet stake to mainnet.
 */
export function caip2Of(account: string): string {
  const segments = account.split(":");
  if (segments.length < 3 || segments[0] === "" || segments[1] === "") {
    throw new Error(
      `Cannot read a CAIP-2 chain id from ${JSON.stringify(account)}: ` +
        `expected a CAIP-10 account of the form "namespace:reference:address".`,
    );
  }
  return `${segments[0]}:${segments[1]}`;
}

/**
 * Signs and broadcasts one stake intent, and hands back the signature.
 *
 * The `null` check is not defensive padding. `transaction` is legitimately
 * `null` on a withdrawal the chain would refuse (`CreateStakeIntentResponseDto`
 * — still a 201, with `blockedBy` carrying the reason), so the caller can
 * reach here holding a perfectly valid response. A thrown sentence is what the
 * screen can show; a dereference is a `TypeError` about a property of null.
 */
export async function runStakeIntent(
  intent: StakeIntent,
  signer: Signer,
): Promise<{ signature: string }> {
  if (!intent.transaction) {
    throw new Error(
      "This intent carries no transaction to sign" +
        (intent.blockedBy ? ` — it was blocked by ${intent.blockedBy}.` : "."),
    );
  }

  /*
    No decoding and no chain derivation here any more. The transaction names
    its own chain and the signer is bound to one, so `signAndSend`
    refuses a mismatch by name — which is strictly stronger than the old
    `caip2Of(intent.account)`, whose only check was that the string had three
    segments.
  */
  const { transaction } = intent;
  if (
    intent.kind === "DEPOSIT" &&
    transaction.namespace === "eip155" &&
    transaction.kind === "transaction"
  ) {
    await approveStakeDeposit(intent, transaction, signer);
  }
  return { signature: await signer.signAndSend(transaction) };
}

/**
 * `approve(stake, amount)` on the stake asset, mined, before an eip155 stake
 * deposit — or nothing, when the allowance already covers it.
 *
 * `X402Stake.depositStake` pulls with `transferFrom`, and the backend builds
 * only that second call: it cannot even be estimated against a zero allowance.
 * The approval is sequenced here because its nonce and the deposit's are
 * consecutive and only the wallet knows when the first has landed —
 * `signAndSend` then refills the deposit's nonce and gas behind it. The same
 * two beats `features/funding/evm-deposit.ts` runs for a buyer.
 */
async function approveStakeDeposit(
  intent: StakeIntent,
  deposit: Eip155UnsignedTransaction,
  signer: Signer,
): Promise<void> {
  if (!intent.amount) {
    throw new Error("This deposit intent carries no amount. Nothing was sent.");
  }
  const token = intent.amount.asset.split("/erc20:")[1];
  if (!token) {
    throw new Error(
      `The stake asset ${intent.amount.asset} is not an ERC-20 on this chain. Nothing was sent.`,
    );
  }
  const amount = BigInt(intent.amount.amount);

  const { allowanceAtomic } = await readDepositReadiness({
    chainId: deposit.chainId,
    owner: signer.address,
    token,
    spender: deposit.to,
  });
  if (allowanceAtomic >= amount) return;

  const approve = await fillTransaction({
    chainId: deposit.chainId,
    from: signer.address,
    to: token,
    data: encodeApprove(deposit.to, amount),
  });
  if (signer.kind === "external") {
    // An injected wallet cannot sign without sending, so it sends the approval
    // itself; `depositStake` is only estimable once that has landed.
    await waitForSuccess(deposit.chainId, (await signer.signAndSend(approve)) as `0x${string}`);
    return;
  }
  const signed = await signer.signTransaction(approve);
  if (signed.namespace !== "eip155") {
    throw new Error(`Expected an eip155 signature, got ${signed.namespace}.`);
  }
  await broadcastAndWait(deposit.chainId, signed.rawTransaction);
}
