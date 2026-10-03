import { describe, expect, it, vi } from "vitest";

import { runEscrowIntent } from "./run-escrow-intent";

import { assertChainMatches, type Signer } from "@/hooks/useSigner";
import type { UnsignedChainTransaction } from "@/interfaces/chain-transaction";

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

function tx(transactionBase64: string, chainId = DEVNET): UnsignedChainTransaction {
  return {
    namespace: "solana",
    chainId,
    kind: "transaction",
    transactionBase64,
    feePayer: "Fee1111111111111111111111111111111111111111",
    signers: ["Own11111111111111111111111111111111111111111"],
    blockhash: "Bh111111111111111111111111111111111111111111",
    lastValidBlockHeight: "123456789",
  };
}

/**
 * A signer bound to devnet. `signAndSend` runs the REAL `assertChainMatches`,
 * so the refusal test below asserts the shipped guard and not a stub of it.
 */
function signerSpy(signature = "sig-1", chainId = DEVNET) {
  /** What actually reached the wallet — pushed only AFTER the guard passes. */
  const sentToWallet: UnsignedChainTransaction[] = [];
  const signAndSend = vi.fn(async (transaction: UnsignedChainTransaction) => {
    assertChainMatches(chainId, transaction);
    sentToWallet.push(transaction);
    return signature;
  });
  return { signer: { chainId, signAndSend } as unknown as Signer, signAndSend, sentToWallet };
}

describe("runEscrowIntent", () => {
  it("hands the wallet the server's payload, with the chain the backend built for on it", async () => {
    const { signer, signAndSend } = signerSpy("sig-abc");
    const transaction = tx("aGVsbG8=");
    const result = await runEscrowIntent(
      { account: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:9xQe", transaction },
      signer,
    );

    expect(result).toEqual({ signature: "sig-abc" });
    const [sent] = signAndSend.mock.calls[0];
    if (sent.namespace !== "solana") throw new Error(`expected the solana member, got ${sent.namespace}`);
    /*
      The envelope, not bytes. Decoding moved into the signer — the runner's job
      is to pass through the one object that names its own chain, because that
      is what the signer checks against its binding.
    */
    expect(sent).toBe(transaction);
    expect(sent.transactionBase64).toBe("aGVsbG8=");
    // The chain the backend built for, never one the browser chose.
    expect(sent.chainId).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("preserves the base64 exactly, including bytes above 0x7f", async () => {
    const { signer, signAndSend } = signerSpy();
    // "/wCA" is 0xff 0x00 0x80 — a wallet cannot parse a transaction that got
    // longer, and re-encoding is exactly what would lengthen it.
    await runEscrowIntent({ account: `${DEVNET}:9xQe`, transaction: tx("/wCA") }, signer);
    const [sent] = signAndSend.mock.calls[0];
    if (sent.namespace !== "solana") throw new Error(`expected the solana member, got ${sent.namespace}`);
    expect(sent.transactionBase64).toBe("/wCA");
  });

  it("refuses a transaction that names another chain, rather than signing it", async () => {
    /*
      This replaces "refuses an account it cannot read a chain id from". That
      check derived the chain from `intent.account` and only ever proved the
      string had three segments — it never compared it against anything. The
      binding is strictly stronger and it is the same failure it was protecting
      against: bytes signed for the wrong network. `caip2Of`'s own refusal
      assertions are unchanged, in `run-stake-intent.test.ts`.
    */
    const { signer, sentToWallet } = signerSpy();
    await expect(
      runEscrowIntent(
        { account: `${DEVNET}:9xQe`, transaction: tx("aGVsbG8=", "eip155:46630") },
        signer,
      ),
    ).rejects.toThrow(/bound to/);
    /* The refusal lands before anything reaches a wallet. */
    expect(sentToWallet).toEqual([]);
  });
});
