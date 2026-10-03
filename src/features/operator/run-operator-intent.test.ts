import { describe, expect, it, vi } from "vitest";

import { addressOf, chainIdOf, runOperatorIntent, signerIsHolder } from "./run-operator-intent";

import { assertChainMatches, type Signer } from "@/hooks/useSigner";
import type { UnsignedChainTransaction } from "@/interfaces/chain-transaction";
import { SOLANA_DEVNET_CAIP2 } from "@/libs/chains/solana/chains";

const CAIP10 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PQ";
const BARE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PQ";

/**
 * A signer bound to a chain, running the REAL `assertChainMatches`.
 *
 * The operator console's own signer is bound with `chainIdOf(identity)` — the
 * same expression `runOperatorIntent` composes its payload with — so these
 * fixtures bind the same way. A stub that accepted anything would make every
 * assertion below about the payload's chain vacuous.
 */
function signerSpy(signature = "sig-1", chainId = SOLANA_DEVNET_CAIP2) {
  const signAndSend = vi.fn(async (transaction: UnsignedChainTransaction) => {
    assertChainMatches(chainId, transaction);
    return signature;
  });
  return { signer: { chainId, signAndSend } as unknown as Signer, signAndSend };
}

describe("addressOf", () => {
  it("passes a bare base58 address through unchanged", () => {
    // This is the shape both operator routes actually send:
    // `CompensationIntentDto.depositor` and `CancelIntentDto.admin` are
    // documented as base58, not CAIP-10.
    expect(addressOf(BARE)).toBe(BARE);
  });

  it("also unwraps a CAIP-10 account, since tolerating both costs one split", () => {
    expect(addressOf(CAIP10)).toBe(BARE);
  });
});

describe("chainIdOf", () => {
  it("falls back to this build's cluster for a bare base58 address", () => {
    // The operator routes carry no chain id at all. Refusing without one would
    // mean the sign button never appeared, so the cluster comes from the same
    // constant `useSigner` and `providers/index.tsx` already assume.
    expect(chainIdOf(BARE)).toBe(SOLANA_DEVNET_CAIP2);
  });

  it("prefers a chain id the server actually named", () => {
    // Evidence beats a constant wherever there is any.
    expect(chainIdOf(CAIP10)).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("never resolves to mainnet by omission, which is Privy's own default", () => {
    expect(chainIdOf(BARE)).not.toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });
});

describe("signerIsHolder", () => {
  it("matches a connected wallet against the bare base58 the routes send", () => {
    expect(signerIsHolder(BARE, BARE)).toBe(true);
  });

  it("matches it against a CAIP-10 identity too", () => {
    expect(signerIsHolder(BARE, CAIP10)).toBe(true);
  });

  it("is case-sensitive, because base58 is", () => {
    expect(signerIsHolder(BARE.toLowerCase(), CAIP10)).toBe(false);
  });
});

describe("runOperatorIntent", () => {
  it("signs a bare base58 identity against this build's cluster", async () => {
    const { signer, signAndSend } = signerSpy("sig-abc");
    // "hello" — a byte sequence whose base64 is checkable by eye.
    const result = await runOperatorIntent("aGVsbG8=", BARE, signer);

    expect(result).toEqual({ signature: "sig-abc" });
    const [sent] = signAndSend.mock.calls[0];
    /*
      These two routes serve a BARE base64 string, so this is the one place a
      unsigned-transaction envelope is composed in the browser. The composition is asserted, not
      assumed: a `kind` or `namespace` wrong here reaches the signer's own
      narrowing and throws CHAIN_OPERATION_UNSUPPORTED with no explanation of
      where the bad member came from.
    */
    expect(sent).toEqual({
      namespace: "solana",
      chainId: SOLANA_DEVNET_CAIP2,
      kind: "transaction",
      transactionBase64: "aGVsbG8=",
      feePayer: "",
      signers: [],
      blockhash: "",
      lastValidBlockHeight: "",
    });
  });

  it("uses the chain a CAIP-10 identity names, over the constant", async () => {
    const { signer, signAndSend } = signerSpy("sig-1", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
    await runOperatorIntent("aGVsbG8=", CAIP10, signer);
    const [sent] = signAndSend.mock.calls[0];
    expect(sent.chainId).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("passes the base64 through untouched, including bytes above 0x7f", async () => {
    const { signer, signAndSend } = signerSpy();
    // "/wCA" is 0xff 0x00 0x80 — a wallet cannot parse a transaction that got
    // longer, and re-encoding is exactly what would lengthen it.
    await runOperatorIntent("/wCA", BARE, signer);
    const [sent] = signAndSend.mock.calls[0];
    if (sent.namespace !== "solana") throw new Error(`expected the solana member, got ${sent.namespace}`);
    expect(sent.transactionBase64).toBe("/wCA");
  });

  it("always declares a chain, so the wallet never falls back to mainnet", async () => {
    // Privy defaults `chain` to `solana:mainnet` when a caller omits it. An
    // `undefined` reaching the wallet here is the one failure that would move
    // real money, so it is asserted rather than assumed.
    const { signer, signAndSend } = signerSpy();
    await runOperatorIntent("aGVsbG8=", "", signer);
    const [sent] = signAndSend.mock.calls[0];
    expect(sent.chainId).toBe(SOLANA_DEVNET_CAIP2);
    expect(sent.chainId).not.toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });

  it("refuses when the signer is bound to a chain the identity does not name", async () => {
    /*
      The screen derives the signer's chain with `chainIdOf` and this function
      composes the payload with `chainIdOf` too, so the two agree by
      construction. This is the assertion that says what happens if a future
      edit breaks that: a refusal before the wallet, not a signature over the
      wrong network.
    */
    const { signer } = signerSpy("sig-1", "eip155:46630");
    await expect(runOperatorIntent("aGVsbG8=", BARE, signer)).rejects.toThrow(/bound to/);
  });
});
