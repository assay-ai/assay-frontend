import type { UnsignedChainTransaction } from "@/interfaces/chain-transaction";

/**
 * The one sentence a signing screen prints about the payload it is holding.
 *
 * Three screens printed *"Fee payer X. Valid to block height Y."* — a Solana
 * sentence, unconditionally — and now the same field can be an EVM
 * transaction or a relayed signature request, neither of which has a fee payer
 * or a block height. Rendering that prose over an `eip155` payload would put
 * `undefined` in front of somebody about to approve a money movement, so the
 * narrowing happens once, here, and every member gets its own true sentence.
 *
 * The typed-data sentence says explicitly that nothing is broadcast from the
 * browser, because that is the member's whole point: the platform's
 * relayer submits it, and a screen that implies otherwise is describing a
 * submit path this platform does not have.
 */
export function unsignedPayloadSummary(tx: UnsignedChainTransaction): string {
  if (tx.namespace === "solana") {
    return `Fee payer ${tx.feePayer}. Valid to block height ${tx.lastValidBlockHeight}.`;
  }
  if (tx.kind === "typed-data") {
    return (
      `A signature request, not a transaction — ${tx.primaryType} for ` +
      `${tx.domain.verifyingContract} on chain ${tx.domain.chainId}. Your wallet signs it and ` +
      `the platform's relayer submits the call; nothing is broadcast from this browser.`
    );
  }
  return `From ${tx.from} to ${tx.to}. Nonce ${tx.nonce}, gas limit ${tx.gasLimit}.`;
}
