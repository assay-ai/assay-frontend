import { base58Encode } from "@/features/m41/base58";
import type { Signer } from "@/hooks/useSigner";
import type { Eip155TypedDataRequest } from "@/interfaces/chain-transaction";
import type { ProofTypedData } from "@/interfaces/provider-payouts";
import { assertTypedData } from "@/libs/chains/evm/signing-guard";

/** Which proof the screen asked for; each has its own primary type and verifying contract. */
export type ProofKind = "PAYOUT_ADDRESS" | "STAKE_AUTHORITY";

const PROOF_PRIMARY_TYPE: Record<ProofKind, string> = {
  PAYOUT_ADDRESS: "PayoutProof",
  STAKE_AUTHORITY: "StakeAuthorityProof",
};

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
 * So on eip155 it is checked first (frontend review 2026-10-15, F1): the
 * proof's own primary type, the pinned domain and contract, and the connected
 * wallet as the account proved. Without that, a "proof" could be an escrow
 * delegate grant or limits change for that same wallet.
 */
export async function signProofChallenge(
  signer: Signer,
  challenge: { message: string; typedData: ProofTypedData | null },
  kind: ProofKind,
): Promise<string> {
  if (challenge.typedData) {
    const request: Omit<Eip155TypedDataRequest, "relayed"> = {
      namespace: "eip155",
      chainId: signer.chainId,
      kind: "typed-data",
      ...challenge.typedData,
    };
    assertTypedData(request, {
      chainId: signer.chainId,
      primaryTypes: [PROOF_PRIMARY_TYPE[kind]],
      message: { account: signer.address },
    });
    return signer.signTypedData(request);
  }
  return base58Encode(await signer.signMessage(new TextEncoder().encode(challenge.message)));
}
