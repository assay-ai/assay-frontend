import { describe, expect, it, vi } from "vitest";

import { signProofChallenge } from "@/features/provider-proof/sign-proof-challenge";
import type { Signer } from "@/hooks/useSigner";

/*
  The payout and stake-authority proofs, as the wallet is asked for them.

  On eip155 the backend verifies EIP-712, and the challenge's `message` is its
  32-byte digest decoded as text — signing that as a personal message produced
  mojibake in the prompt and a signature that never recovers. So when the
  challenge carries `typedData`, that is what is signed and the hex signature
  goes back untouched; the base58 path is the Solana one and stays exactly as
  it was.
*/
const TYPED = {
  domain: {
    name: "Assay Settlement",
    version: "2",
    chainId: "46630",
    verifyingContract: "0x1eDb0E45747cfEf778bDB4f4418319efc0DD814f",
  },
  types: {
    PayoutProof: [
      { name: "account", type: "address" },
      { name: "organizationId", type: "string" },
      { name: "nonce", type: "string" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  primaryType: "PayoutProof",
  message: {
    account: "0x31b1DF6F36ec62075a3BE03a5C0BebB06534bA72",
    organizationId: "org-1",
    nonce: "n-1",
    expiresAt: "1800000000",
  },
};

function signer(chainId: string): Signer {
  return {
    address: "0x31b1DF6F36ec62075a3BE03a5C0BebB06534bA72",
    kind: "embedded",
    chainId,
    signMessage: vi.fn(async () => new Uint8Array([1, 2, 3])),
    signTypedData: vi.fn(async () => "0xabcdef" as const),
    signTransaction: vi.fn(),
    signAndSend: vi.fn(),
  };
}

describe("signProofChallenge", () => {
  it("signs the typed data on eip155 and returns the hex signature as-is", async () => {
    const s = signer("eip155:46630");

    const signature = await signProofChallenge(s, { message: "\u0000garbage", typedData: TYPED }, "PAYOUT_ADDRESS");

    expect(signature).toBe("0xabcdef");
    expect(s.signTypedData).toHaveBeenCalledWith({
      namespace: "eip155",
      chainId: "eip155:46630",
      kind: "typed-data",
      ...TYPED,
    });
    /* Assert the loser: the digest-as-text was never offered as a message. */
    expect(s.signMessage).not.toHaveBeenCalled();
  });

  it("signs the message and base58-encodes it when there is no typed data", async () => {
    const s = signer("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");

    const signature = await signProofChallenge(s, { message: "assay payout proof v1", typedData: null }, "PAYOUT_ADDRESS");

    expect(s.signMessage).toHaveBeenCalledWith(new TextEncoder().encode("assay payout proof v1"));
    expect(signature).toBe("Ldp");
    expect(s.signTypedData).not.toHaveBeenCalled();
  });

  /*
    Frontend review 2026-10-15, F1: the challenge is the API's, so a proof
    screen could be handed an escrow grant for the same wallet to sign.
  */
  it("refuses a challenge that is not this proof under the pinned domain", async () => {
    const s = signer("eip155:46630");
    const grant = {
      domain: { ...TYPED.domain, verifyingContract: "0x000000000000000000000000000000000000dEaD" },
      types: { AuthorizeDelegate: [{ name: "payer", type: "address" }] },
      primaryType: "AuthorizeDelegate",
      message: { payer: "0x31b1DF6F36ec62075a3BE03a5C0BebB06534bA72" },
    };
    await expect(signProofChallenge(s, { message: "x", typedData: grant }, "PAYOUT_ADDRESS")).rejects.toThrow(
      /signs PayoutProof, not AuthorizeDelegate/,
    );
    // A payout proof is not a stake-authority proof, and the reverse.
    await expect(signProofChallenge(s, { message: "x", typedData: TYPED }, "STAKE_AUTHORITY")).rejects.toThrow(
      /StakeAuthorityProof/,
    );
    // Another account than the connected wallet.
    const other = { ...TYPED, message: { ...TYPED.message, account: "0x000000000000000000000000000000000000dEaD" } };
    await expect(signProofChallenge(s, { message: "x", typedData: other }, "PAYOUT_ADDRESS")).rejects.toThrow(
      /account/,
    );
    expect(s.signTypedData).not.toHaveBeenCalled();
  });
});
