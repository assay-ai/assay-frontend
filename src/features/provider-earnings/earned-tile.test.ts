import { describe, expect, it } from "vitest";

import type { Money, ProviderEarningsFigures } from "@/interfaces";

import { EARNED_IN_WALLET, earnedTileSub, earningsSplit } from "./earned-tile";

const USDG = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const usdg = (amount: string): Money => ({ amount, asset: USDG, decimals: 6 });
const format = (value: Money) => `$${(Number(value.amount) / 1e6).toFixed(2)}`;

function totals(overrides: Partial<ProviderEarningsFigures> = {}): ProviderEarningsFigures {
  return {
    calls: 51,
    earned: usdg("4590000"),
    platformFee: usdg("470000"),
    withheld: usdg("0"),
    withheldCalls: 0,
    ...overrides,
  };
}

describe("earnedTileSub", () => {
  it("says the whole figure is in the wallet when nothing was absorbed", () => {
    expect(earnedTileSub(totals({ absorbed: usdg("0"), absorbedCalls: 0 }), format)).toBe(
      EARNED_IN_WALLET,
    );
    // An older backend that does not send the field.
    expect(earnedTileSub(totals(), format)).toBe(EARNED_IN_WALLET);
    expect(earnedTileSub(undefined, format)).toBe(EARNED_IN_WALLET);
  });

  // BUG-J-POSTP-01: 4 calls credited from platform funds read as "already in your wallet".
  it("splits out what the platform owes for vouchers that could not be redeemed", () => {
    const sub = earnedTileSub(totals({ absorbed: usdg("360000"), absorbedCalls: 4 }), format);

    expect(sub).toBe(
      "$4.23 in your wallet · $0.36 owed by the platform for 4 calls whose voucher could not be redeemed",
    );
    expect(sub).not.toContain("already in your wallet");
  });

  it("uses the singular for one call", () => {
    expect(earnedTileSub(totals({ absorbed: usdg("90000"), absorbedCalls: 1 }), format)).toMatch(
      /for 1 call whose/,
    );
  });
});

describe("earningsSplit", () => {
  const usd = (amount: string) => ({ amount, asset: "usdg", decimals: 6 });
  it("takes what could not be collected out of the wallet figure and never calls it owed", () => {
    const split = earningsSplit({
      calls: 10,
      earned: usd("5000000"),
      platformFee: usd("500000"),
      withheld: usd("0"),
      withheldCalls: 0,
      absorbed: usd("1000000"),
      absorbedCalls: 2,
    });
    expect(split.inWallet?.amount).toBe("4000000");
    expect(split.uncollected?.amount).toBe("1000000");
    expect(split.uncollectedCalls).toBe(2);
    expect(split.notCredited).toBeNull();
  });
});
