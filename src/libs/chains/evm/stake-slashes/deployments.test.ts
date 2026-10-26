import { afterEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("./deployments");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PINNED_STAKE", () => {
  it("pins the mainnet contracts in a production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_EVM_DEPLOYMENT", "production");
    const m = await load();
    expect(m.PINNED_STAKE).toBe(m.ROBINHOOD_MAINNET_STAKE);
    expect(m.PINNED_STAKE.chainId).toBe("eip155:4663");
    expect(m.PINNED_STAKE.escrowContract).toBe("0xe54E0142b1D0d34226498D563A16074C81Bc9A5e");
    expect(m.PINNED_STAKE.settlementToken).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(m.PINNED_STAKE.displayName.toLowerCase()).not.toContain("testnet");
  });

  it("pins the develop contracts when unset or anything else", async () => {
    for (const value of [undefined, "dev", "Production"]) {
      if (value === undefined) vi.stubEnv("NEXT_PUBLIC_EVM_DEPLOYMENT", undefined as unknown as string);
      else vi.stubEnv("NEXT_PUBLIC_EVM_DEPLOYMENT", value);
      const m = await load();
      expect(m.PINNED_STAKE).toBe(m.ROBINHOOD_TESTNET_DEV_STAKE);
    }
  });

  it("keeps the two stacks on different chains and contracts", async () => {
    const m = await load();
    const dev = m.ROBINHOOD_TESTNET_DEV_STAKE;
    const prod = m.ROBINHOOD_MAINNET_STAKE;
    expect(prod.chainId).not.toBe(dev.chainId);
    for (const key of ["stakeContract", "escrowContract", "configContract"] as const) {
      expect(prod[key].toLowerCase()).not.toBe(dev[key].toLowerCase());
    }
  });
});
