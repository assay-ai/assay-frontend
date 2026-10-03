import { base58Encode } from "@/features/m41/base58";
import type { Signer } from "@/hooks/useSigner";
import type { ProofTypedData } from "@/interfaces/provider-payouts";

/**
 * Sign a payout-address or stake-authority challenge the way its chain
 * verifies it, and return the signature in the encoding `prove` takes.
 *
 * - `typedData` present (eip155): the backend verifies EIP-712, so the wallet
 *   signs the typed data and the `0x` hex signature goes back as-is. The
 *   challenge's `message` there is a 32-byte digest decoded as text — shown in a
 *   prompt it is mojibake, and signed as a personal message it never recovers.
 * - `typedData` null (Solana): `message` is exactly what is signed, and the
 *   ed25519 signature goes back base58, which the backend decodes.
 *
 * The console never builds either payload: both come from the stored challenge.
 */
export async function signProofChallenge(
  signer: Signer,
  challenge: { message: string; typedData: ProofTypedData | null },
): Promise<string> {
  if (challenge.typedData) {
    return signer.signTypedData({
      namespace: "eip155",
      chainId: signer.chainId,
      kind: "typed-data",
      ...challenge.typedData,
    });
  }
  return base58Encode(await signer.signMessage(new TextEncoder().encode(challenge.message)));
}
