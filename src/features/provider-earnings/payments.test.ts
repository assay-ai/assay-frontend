import { describe, expect, it } from "vitest";

import { isTransactionRef } from "./payments";

describe("isTransactionRef", () => {
  it("accepts an EVM hash and a base58 signature", () => {
    expect(isTransactionRef(`0x${"a".repeat(64)}`)).toBe(true);
    expect(isTransactionRef("5Yx9mQ2vT8kLbP3n")).toBe(true);
  });

  it("refuses a missing ref and every ledger marker", () => {
    for (const ref of [null, undefined, "", "unobserved:seq=1", "held_collected:seq=4", "legacy:pooled-vault-no-chain-transfer"]) {
      expect(isTransactionRef(ref)).toBe(false);
    }
  });
});
