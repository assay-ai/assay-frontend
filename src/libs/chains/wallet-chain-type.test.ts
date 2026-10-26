import { describe, expect, it } from "vitest";

import { walletChainTypeFor } from "./wallet-chain-type";

describe("walletChainTypeFor", () => {
  it("follows the served namespaces", () => {
    expect(walletChainTypeFor([{ chainId: "eip155:46630", namespace: "eip155" }])).toBe("ethereum-only");
    expect(walletChainTypeFor([{ chainId: "solana:devnet", namespace: "solana" }])).toBe("solana-only");
    expect(
      walletChainTypeFor([
        { chainId: "eip155:46630", namespace: "eip155" },
        { chainId: "solana:devnet", namespace: "solana" },
      ]),
    ).toBe("ethereum-and-solana");
  });

  it("offers both while the list is empty", () => {
    expect(walletChainTypeFor([])).toBe("ethereum-and-solana");
  });
});
