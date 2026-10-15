import { describe, expect, it, vi } from "vitest";

vi.mock("@/libs/chains/evm/deposit-transaction", () => ({ readDepositReadiness: vi.fn() }));

import { stakePreflight } from "./stake-preflight";

const base = { decimals: 6, tokenSymbol: "USDG", nativeSymbol: "ETH" };

describe("stakePreflight", () => {
  it("says nothing before the balances are read", () => {
    expect(stakePreflight({ ...base, balances: null, amountAtomic: "1000000" })).toEqual({ rows: [], blocker: null });
  });

  it("blocks when the wallet holds less than the amount, naming both", () => {
    const result = stakePreflight({
      ...base,
      balances: { tokenAtomic: 40_000_000n, nativeWei: 10n ** 15n },
      amountAtomic: "100000000",
    });
    expect(result.blocker).toBe("This wallet holds $40.00 USDG, less than the $100.00 you are staking. Add USDG to it or stake less.");
    expect(result.rows[0]).toMatchObject({ value: "$40.00 USDG", bad: true });
    expect(result.rows[1]?.bad).toBe(false);
  });

  it("blocks when there is no gas at all", () => {
    const result = stakePreflight({ ...base, balances: { tokenAtomic: 500_000_000n, nativeWei: 0n }, amountAtomic: "100000000" });
    expect(result.blocker).toMatch(/no ETH to pay the network fee/);
    expect(result.rows[1]?.bad).toBe(true);
  });

  it("lets a covered amount through", () => {
    const result = stakePreflight({ ...base, balances: { tokenAtomic: 500_000_000n, nativeWei: 1n }, amountAtomic: "100000000" });
    expect(result.blocker).toBeNull();
    expect(result.rows.every((row) => !row.bad)).toBe(true);
  });
});
