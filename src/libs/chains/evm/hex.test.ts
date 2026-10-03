import { describe, expect, it } from "vitest";

import { hexToBytes } from "./hex";

describe("hexToBytes", () => {
  it("decodes a 0x string to the exact bytes", () => {
    expect(Array.from(hexToBytes("0x0102ff"))).toEqual([1, 2, 255]);
    expect(Array.from(hexToBytes("0x"))).toEqual([]);
  });

  it("accepts either case", () => {
    expect(hexToBytes("0xDEADbeef")).toEqual(hexToBytes("0xdeadBEEF"));
  });

  it("refuses an odd number of digits rather than dropping a nibble", () => {
    // A signature silently one nibble short verifies against nobody, and the
    // failure surfaces on chain after the user approved the prompt.
    expect(() => hexToBytes("0xabc")).toThrow(/odd number of digits/);
  });

  it("refuses a string with no 0x prefix rather than guessing", () => {
    expect(() => hexToBytes("0102ff")).toThrow(/0x-prefixed/);
  });

  it("refuses non-hex characters, naming the offending byte", () => {
    expect(() => hexToBytes("0x01zz")).toThrow(/byte 1/);
    // Assert the loser: it did not quietly produce NaN, which becomes 0.
    expect(() => hexToBytes("0x01zz")).toThrow(/"zz"/);
  });
});
