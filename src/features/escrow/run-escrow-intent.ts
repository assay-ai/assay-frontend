/**
 * @fileoverview
 * Signing one escrow intent.
 *
 * Three instructions reach the chain through this function —
 * `set_escrow_limits`, `request_withdraw` and `withdraw`, all of them the
 * buyer's own. The browser builds none of them. The backend answers each POST
 * with unsigned base64 wire bytes, and the browser's entire job is to put the
 * *owner's* signature on them. That is the property the whole
 * security-hardening effort exists to buy: only the owner withdraws, and a
 * leaked platform key moves nothing.
 *
 * **`transaction` is not nullable here, and that is the difference from
 * `runStakeIntent`.** The stake path answers a refusal as a 201 carrying
 * `transaction: null` and a `blockedBy` reason. The escrow controller does not
 * do that — verified against the shipped DTOs: `transaction` is non-nullable
 * on the envelope, and every refusal is an HTTP status instead (409 for a rule
 * the chain would break, 503 when the chain could not be read). So there is no null branch to write
 * here; a caller that writes one is rendering a state the server never sends,
 * while the real refusal falls through to an unhandled error path.
 *
 * **The decoding and the chain derivation both left this file.** The wire's
 * `UnsignedChainTransaction` names its own chain and carries its own encoding,
 * and `useSigner`'s signer is bound to one chain and refuses another's payload
 * by name. `intent.account` is still here, and still CAIP-10, because the
 * screen uses it to ASK for the right signer — but it is no longer what tells
 * the wallet which network these bytes are for.
 */

import type { Signer } from "@/hooks/useSigner";
import type { UnsignedChainTransaction } from "@/interfaces/chain-transaction";

/**
 * The two fields every signable envelope shares. Deliberately structural
 * rather than `EscrowIntent` itself: the operator console signs a compensation
 * deposit and an admin cancel through the same helper, and this function has
 * no business reading whatever else an envelope carries.
 */
export interface SignableIntent {
  /**
   * CAIP-10. The backend documents it as never taken from the request, so it
   * names the chain the transaction was actually built for — which is how a
   * screen knows which `useSigner({ chainId })` to ask for. It is deliberately
   * NOT read here: the transaction below names its own chain, and the signer
   * checks the two against each other.
   */
  account: string;
  transaction: UnsignedChainTransaction;
}

/** Signs and broadcasts one intent, and hands back the signature. */
export async function runEscrowIntent(
  intent: SignableIntent,
  signer: Signer,
): Promise<{ signature: string }> {
  return { signature: await signer.signAndSend(intent.transaction) };
}
