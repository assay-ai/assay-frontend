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
    name: "x402 Settlement",
    version: "2",
    chainId: "46630",
    verifyingContract: "0x3333333333333333333333333333333333333333",
  },
  types: { PayoutProof: [{ name: "account", type: "address" }] },
  primaryType: "PayoutProof",
  message: { account: "0x31b1DF6F36ec62075a3BE03a5C0BebB06534bA72", expiresAt: "1800000000" },
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

    const signature = await signProofChallenge(s, { message: "\u0000garbage", typedData: TYPED });

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

    const signature = await signProofChallenge(s, { message: "x402 payout proof v1", typedData: null });

    expect(s.signMessage).toHaveBeenCalledWith(new TextEncoder().encode("x402 payout proof v1"));
    expect(signature).toBe("Ldp");
    expect(s.signTypedData).not.toHaveBeenCalled();
  });
});
