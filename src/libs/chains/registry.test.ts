import { describe, expect, it } from "vitest";

import { addressStyleOf, isEvmChain, namespaceOf } from "./registry";

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM_TESTNET = "eip155:46630";

describe("namespaceOf", () => {
  it("reads the CAIP-2 namespace off both shapes", () => {
    expect(namespaceOf(SOLANA_DEVNET)).toBe("solana");
    expect(namespaceOf(EVM_TESTNET)).toBe("eip155");
  });

  it("returns the empty string rather than a guess for a malformed id", () => {
    // A guessed namespace reaches addressStyleOf, and the guess that is
    // cheapest to write ("solana", because it is what everything was) is the
    // one that renders an 0x address four characters short.
    expect(namespaceOf("mainnet")).toBe("");
    expect(namespaceOf("")).toBe("");
    expect(namespaceOf(":46630")).toBe("");
  });

  it("does not answer from Object.prototype", () => {
    // The argument is attacker-adjacent data off the wire. A lookup keyed
    // through an object literal answers "constructor" with a function;
    // `useSigner` already made this exact defence with a Map.
    expect(namespaceOf("constructor")).toBe("");
    expect(namespaceOf("toString")).toBe("");
  });
});

describe("isEvmChain", () => {
  it("is true for eip155 and false for everything else, including malformed", () => {
    expect(isEvmChain(EVM_TESTNET)).toBe(true);
    expect(isEvmChain("eip155:1")).toBe(true);
    // Assert the loser: a predicate that returned true unconditionally passes
    // the two lines above on their own.
    expect(isEvmChain(SOLANA_DEVNET)).toBe(false);
    expect(isEvmChain("mainnet")).toBe(false);
    expect(isEvmChain("")).toBe(false);
  });
});

describe("addressStyleOf", () => {
  it("is hex for eip155 and base58 for everything else", () => {
    expect(addressStyleOf(EVM_TESTNET)).toBe("hex");
    expect(addressStyleOf(SOLANA_DEVNET)).toBe("base58");
  });

  it("falls back to base58 for an unknown namespace, and that is deliberate", () => {
    // base58 shortening of a hex string loses two of the four characters that
    // distinguish addresses; hex shortening of a base58 string invents an "0x"
    // that is not there. Between two wrong answers the one that adds no
    // characters is the recoverable one.
    expect(addressStyleOf("cosmos:cosmoshub-4")).toBe("base58");
    expect(addressStyleOf("")).toBe("base58");
  });
});
