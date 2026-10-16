import { describe, expect, it } from "vitest";

import type { Money, ProviderEarningsFigures } from "@/interfaces";

import { EARNED_IN_WALLET, earnedTileSub, earningsSplit, unpaidLines } from "./earned-tile";

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
  it("says the whole figure is in the wallet when no buyer debt is open", () => {
    expect(earnedTileSub(totals({ debtOutstanding: usdg("0"), debtOutstandingCalls: 0 }), format)).toBe(
      EARNED_IN_WALLET,
    );
    // An older backend that does not send the field.
    expect(earnedTileSub(totals(), format)).toBe(EARNED_IN_WALLET);
    expect(earnedTileSub(undefined, format)).toBe(EARNED_IN_WALLET);
  });

  it("names open buyer debt beside the wallet figure, never as owed by the platform", () => {
    const sub = earnedTileSub(totals({ debtOutstanding: usdg("360000"), debtOutstandingCalls: 4 }), format);
    expect(sub).toBe(`${EARNED_IN_WALLET} · $0.36 more for 4 calls is waiting on buyers`);
    expect(sub).not.toMatch(/platform/);
  });

  it("uses the singular for one call", () => {
    expect(
      earnedTileSub(totals({ debtOutstanding: usdg("90000"), debtOutstandingCalls: 1 }), format),
    ).toMatch(/for 1 call is/);
  });
});

describe("unpaidLines", () => {
  it("is empty when nothing passed unpaid", () => {
    expect(unpaidLines(totals(), format)).toEqual([]);
    expect(unpaidLines(undefined, format)).toEqual([]);
    expect(
      unpaidLines(totals({ forfeited: usdg("0"), forfeitedCalls: 0, uncollected: null }), format),
    ).toEqual([]);
  });

  it("explains debt, uncollected and forfeited calls in plain words", () => {
    const lines = unpaidLines(
      totals({
        debtOutstanding: usdg("90000"),
        debtOutstandingCalls: 1,
        uncollected: usdg("180000"),
        uncollectedCalls: 2,
        forfeited: usdg("270000"),
        forfeitedCalls: 3,
      }),
      format,
    );
    expect(lines.map((l) => l.key)).toEqual(["debtOutstanding", "uncollected", "forfeited"]);
    expect(lines[0].explanation).toMatch(/^\$0\.09 for 1 call that passed/);
    expect(lines[0].explanation).toMatch(/platform does not pay it/);
    expect(lines[1].explanation).toMatch(/nobody owes it/);
    expect(lines[2].explanation).toMatch(/buyer was not charged/);
    for (const line of lines) expect(line.explanation).not.toMatch(/owed by the platform/);
  });
});

describe("earningsSplit", () => {
  const usd = (amount: string) => ({ amount, asset: "usdg", decimals: 6 });
  it("puts all of earned in the wallet and names open buyer debt apart, never as owed", () => {
    const split = earningsSplit({
      calls: 10,
      earned: usd("5000000"),
      platformFee: usd("500000"),
      withheld: usd("0"),
      withheldCalls: 0,
      debtOutstanding: usd("1000000"),
      debtOutstandingCalls: 2,
      uncollected: usd("300000"),
      uncollectedCalls: 1,
    });
    expect(split.inWallet?.amount).toBe("5000000");
    expect(split.waitingOnBuyers?.amount).toBe("1000000");
    expect(split.waitingOnBuyersCalls).toBe(2);
    expect(split.notCredited).toBeNull();
  });
});
