import { describe, expect, it } from "vitest";

import { deploymentIsTestnet, testnetTitle } from "./testnet-chip";

const robinhood = { chainId: "eip155:46630", displayName: "Robinhood Chain testnet" };
const devnet = { chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", displayName: "Solana devnet" };
const mainnet = { chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", displayName: "Solana" };

describe("deploymentIsTestnet", () => {
  it("is true when every served chain is a test network", () => {
    expect(deploymentIsTestnet([robinhood])).toBe(true);
    expect(deploymentIsTestnet([robinhood, devnet])).toBe(true);
  });

  it("is false on a main network, a mixed list, or no list yet", () => {
    expect(deploymentIsTestnet([mainnet])).toBe(false);
    expect(deploymentIsTestnet([robinhood, mainnet])).toBe(false);
    expect(deploymentIsTestnet([])).toBe(false);
  });
});

describe("testnetTitle", () => {
  it("names the network and says the money is not real", () => {
    expect(testnetTitle([robinhood])).toBe(
      "Runs on Robinhood Chain testnet. Payments use test tokens with no real value.",
    );
  });
});
