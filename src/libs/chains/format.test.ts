import { describe, expect, it } from "vitest";

import { shortAddress } from "./format";

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM_TESTNET = "eip155:46630";

const BASE58 = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const HEX = "0x83ab1234567890abcdef1234567890abcdef2913";

describe("shortAddress", () => {
  it("is four and four on base58", () => {
    expect(shortAddress(SOLANA_DEVNET, BASE58)).toBe("7xKX…gAsU");
  });

  it("keeps the 0x AND four hex characters on eip155", () => {
    // "0x83ab…2913 rather than 0x83…2913, which throws away two of the
    // four characters that distinguish addresses". The literal is written out
    // rather than derived, so a change to the slice offsets fails here.
    expect(shortAddress(EVM_TESTNET, HEX)).toBe("0x83ab…2913");
  });

  it("does not render the same address the same way on two chains", () => {
    // The one assertion that a chain-unaware implementation cannot pass. A
    // function that ignored its chainId argument would satisfy either of the
    // two tests above on its own.
    expect(shortAddress(EVM_TESTNET, HEX)).not.toBe(shortAddress(SOLANA_DEVNET, HEX));
  });

  it("returns a short address unchanged instead of an ellipsis longer than the input", () => {
    expect(shortAddress(SOLANA_DEVNET, "abc")).toBe("abc");
    expect(shortAddress(EVM_TESTNET, "0x1234")).toBe("0x1234");
  });
});
