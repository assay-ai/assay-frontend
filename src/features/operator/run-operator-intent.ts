/**
 * @fileoverview
 * Signing one of the operator console's two build-only intents.
 *
 * `POST /operator/cases/:id/compensation-intent` and
 * `.../cancel-intent` both answer with unsigned base64 wire bytes and the
 * identity of the one key that may sign them — the treasury for a
 * compensation, `Config.admin` for a cancellation. The platform holds neither,
 * which is the entire reason `reverse_slash` was deleted from the program and
 * the verifier's signature was taken off `cancel_slash`.
 *
 * So there are always two paths off this screen, and the copy path is the
 * primary one:
 *
 *  1. **Copy the base64** and take it to wherever the key lives — a multisig
 *     ceremony, a hardware wallet on another machine. This always works.
 *  2. **Sign here**, but only when the wallet already connected in this browser
 *     *is* that key. That is a convenience for a devnet operator, never the
 *     assumption.
 *
 * ## The one route that does not speak the unsigned-transaction union, and what that costs
 *
 * `runStakeIntent` and `runEscrowIntent` are handed an
 * `UnsignedChainTransaction` and pass it straight through. These two operator
 * routes are not: they answer with a **bare base64 string** and a **bare base58
 * address**, which is the operator API's own shape and predates the union. So this
 * function is the one place that has to compose a union member itself, from
 * the base64 the route served and the chain id derived below.
 *
 * The four other fields of the `solana` member — `feePayer`, `signers`,
 * `blockhash`, `lastValidBlockHeight` — have **no producer on these two
 * routes**, so they are composed empty. That is safe only because the object
 * never leaves this function and nothing on the Solana signing path reads
 * them: `useSigner` reads `chainId` and `transactionBase64` and nothing else.
 * The first screen that wants to show an operator intent's fee payer or expiry
 * has to get the backend to serve them; it must not read them from here.
 *
 * ## Where the chain id comes from, and why it is not the identity
 *
 * `CompensationIntentDto.provider` / `.depositor` and `CancelIntentDto.admin` /
 * `.provider` are **bare base58 addresses**. That is the operator API's own
 * shape and it differs from `StakeIntent.account` and the escrow envelopes,
 * which are CAIP-10 — so unlike `runStakeIntent` there is no chain id in the
 * payload to read, and refusing to sign without one would mean the sign button
 * never appeared at all.
 *
 * So the cluster comes from this build's own constant, which is the same
 * assumption the rest of the app already makes and states out loud:
 * `providers/index.tsx` declares an RPC for `solana:devnet` and nothing else,
 * `useSigner` keys its chain map off these constants, and the deposit screen
 * pins its explorer link to `?cluster=devnet` for the same reason. A build
 * pointed at another cluster changes `libs/chains/solana/chains.ts`, and this moves
 * with it.
 *
 * This is a weaker guarantee than `runStakeIntent`'s and worth naming as one:
 * there, the chain id was evidence from the server about the transaction it
 * actually built. Here it is an assumption about the deployment. The bytes are
 * still the server's, and a wallet simulating them against the wrong cluster
 * fails loudly rather than moving money — but the copy path stays the primary
 * one for both of these, and it carries no such assumption.
 */

import { caip2Of } from "@/features/provider-stake/run-stake-intent";
import type { Signer } from "@/hooks/useSigner";
import { SOLANA_DEVNET_CAIP2 } from "@/libs/chains/solana/chains";

/**
 * The bare base58 address out of an identity.
 *
 * The two operator routes send one already; this is a pass-through for them.
 * It also unwraps a CAIP-10 account, because both encodings appear across this
 * API — `StakeIntent.account` is CAIP-10, an escrow claim's `destination` is
 * chain-native — and tolerating both costs one `split`. The last
 * colon-separated segment is the address in CAIP-10 and is the whole string
 * when there are no colons, so one rule covers both.
 */
export function addressOf(identity: string): string {
  const segments = identity.split(":");
  return segments[segments.length - 1] ?? identity;
}

/**
 * The CAIP-2 chain id to declare for these bytes.
 *
 * An identity that carries one wins — that is evidence from the server, and it
 * is strictly better than a constant. A bare base58 address, which is what both
 * operator routes actually send, falls back to this build's cluster.
 *
 * The fallback is a deliberate reversal of `caip2Of`'s "never guess" rule, and
 * the reasoning that rule protects still holds: what makes a guessed chain id
 * dangerous is *silently defaulting to mainnet*, which is what Privy does when
 * a caller omits `chain` entirely. Naming the cluster this build is configured
 * for is the opposite of that — it is the same value `useSigner` would resolve
 * for every other transaction in the app, from the same file.
 */
export function chainIdOf(identity: string): string {
  try {
    return caip2Of(identity);
  } catch {
    return SOLANA_DEVNET_CAIP2;
  }
}

/**
 * True when the wallet connected in this browser is the key these bytes need.
 *
 * Compared on the bare address so a CAIP-10 identity and a wallet's base58
 * address are comparable at all. Case-sensitive on purpose: base58 is
 * case-significant, and a case-insensitive match here would say "this is your
 * key" about an address that is not one.
 */
export function signerIsHolder(signerAddress: string, identity: string): boolean {
  return signerAddress === addressOf(identity);
}

/**
 * Signs and broadcasts one operator intent, and hands back the signature.
 *
 * `transaction` is the raw base64 string these two routes return, not the
 * `{ transactionBase64, feePayer, … }` envelope the escrow and stake routes
 * use — hence a separate function rather than a call into `runEscrowIntent`.
 */
export async function runOperatorIntent(
  transactionBase64: string,
  identity: string,
  signer: Signer,
): Promise<{ signature: string }> {
  const chainId = chainIdOf(identity);
  return {
    signature: await signer.signAndSend({
      namespace: "solana",
      chainId,
      kind: "transaction",
      transactionBase64,
      /* No producer on these two routes — see the fileoverview. */
      feePayer: "",
      signers: [],
      blockhash: "",
      lastValidBlockHeight: "",
    }),
  };
}
