import { describe, expect, it } from "vitest";

import { DEPOSIT_MINIMUM_USD, buyerCostLines } from "./buyer-costs";

const robinhood = {
  chainId: "eip155:46630",
  displayName: "Robinhood Chain testnet",
  settlementAssetSymbol: "USDG",
};
const solana = {
  chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  displayName: "Solana",
  settlementAssetSymbol: "USDC",
};

describe("buyerCostLines", () => {
  it("states the fee rule, the minimum deposit, token, chain, gas and testnet", () => {
    const text = buyerCostLines([robinhood]).join(" ");
    expect(text).toMatch(/includes Assay's fee/);
    expect(text).toContain(`at least $${DEPOSIT_MINIMUM_USD}.00, in USDG on Robinhood Chain testnet`);
    expect(text).toContain("a little ETH on Robinhood Chain testnet");
    expect(text).toMatch(/test network/);
  });

  it("says a non-EVM chain's fee is paid by Assay and claims no testnet on a main network", () => {
    const text = buyerCostLines([solana]).join(" ");
    expect(text).toContain("no network fee on Solana (Assay pays it)");
    expect(text).not.toMatch(/test network/);
  });

  it("names no chain or token before the list is known", () => {
    const text = buyerCostLines([]).join(" ");
    expect(text).toContain(`at least $${DEPOSIT_MINIMUM_USD}.00.`);
    expect(text).not.toMatch(/ETH|test network/);
  });
});
