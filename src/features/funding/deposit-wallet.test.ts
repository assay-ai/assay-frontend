import { describe, expect, it } from "vitest";

import { DEPOSIT_GAS_ESTIMATE, depositWalletView } from "./deposit-wallet";

const base = { decimals: 6, tokenSymbol: "USDG", nativeSymbol: "ETH" };
const balances = (tokenAtomic: bigint, nativeWei: bigint, gasPriceWei: bigint | null = 10_000_000n) => ({ tokenAtomic, nativeWei, gasPriceWei });

describe("depositWalletView (B7)", () => {
  it("shows the wallet's USDG and ETH and an estimate of the fee for both steps", () => {
    const view = depositWalletView({ ...base, balances: balances(50_000_000n, 10n ** 16n), amountAtomic: "20000000" });
    expect(view.rows.map((row) => [row.label, row.value, row.bad])).toEqual([
      ["USDG in this wallet", "$50.00 USDG", false],
      ["ETH for network fees", "0.01 ETH", false],
    ]);
    expect(view.warning).toBeNull();
    expect(DEPOSIT_GAS_ESTIMATE * 10_000_000n).toBe(2_300_000_000_000n);
    expect(view.feeText).toBe("Network fee: about 0.0000023 ETH for both steps; your wallet shows the exact fee.");
  });

  it("warns, never blocks, above what the wallet holds", () => {
    const view = depositWalletView({ ...base, balances: balances(12_000_000n, 10n ** 16n), amountAtomic: "20000000" });
    expect(view.warning).toBe("This wallet seems to hold $12.00 USDG, less than the $20.00 you are depositing. Deposit less, or add USDG to it first.");
    expect(view.rows[0]!.bad).toBe(true);
  });

  it("warns before any prompt when there is no gas, and points at the faucets only when a balance is empty", () => {
    const noGas = depositWalletView({ ...base, balances: balances(50_000_000n, 0n), amountAtomic: "20000000" });
    expect(noGas.warning).toBe("This wallet seems to hold no ETH for the network fee. Send a little ETH to it first.");
    expect(noGas.needsGas).toBe(true);
    expect(noGas.needsToken).toBe(false);
    expect(depositWalletView({ ...base, balances: balances(0n, 10n ** 16n), amountAtomic: null }).needsToken).toBe(true);
  });

  it("says nothing before the balances are read, and no fee without a gas price", () => {
    expect(depositWalletView({ ...base, balances: null, amountAtomic: "20000000" })).toEqual({ rows: [], warning: null, feeText: null, needsToken: false, needsGas: false });
    expect(depositWalletView({ ...base, balances: balances(50_000_000n, 10n ** 16n, null), amountAtomic: null }).feeText).toBeNull();
  });
});
