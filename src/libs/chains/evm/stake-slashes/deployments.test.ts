import { afterEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("./deployments");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ROBINHOOD_TESTNET_STAKE", () => {
  it("pins the production contracts in a production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_EVM_DEPLOYMENT", "production");
    const m = await load();
    expect(m.ROBINHOOD_TESTNET_STAKE).toBe(m.ROBINHOOD_TESTNET_PRODUCTION_STAKE);
    expect(m.ROBINHOOD_TESTNET_STAKE.escrowContract).toBe("0xE68A6E2810027dB5da48c2110bd3993eD8177115");
  });

  it("pins the develop contracts when unset or anything else", async () => {
    for (const value of [undefined, "dev", "Production"]) {
      if (value === undefined) vi.stubEnv("NEXT_PUBLIC_EVM_DEPLOYMENT", undefined as unknown as string);
      else vi.stubEnv("NEXT_PUBLIC_EVM_DEPLOYMENT", value);
      const m = await load();
      expect(m.ROBINHOOD_TESTNET_STAKE).toBe(m.ROBINHOOD_TESTNET_DEV_STAKE);
    }
  });

  it("keeps the two stacks on different contracts", async () => {
    const m = await load();
    const dev = m.ROBINHOOD_TESTNET_DEV_STAKE;
    const prod = m.ROBINHOOD_TESTNET_PRODUCTION_STAKE;
    expect(prod.chainId).toBe(dev.chainId);
    for (const key of ["stakeContract", "escrowContract", "configContract"] as const) {
      expect(prod[key].toLowerCase()).not.toBe(dev[key].toLowerCase());
    }
  });
});
