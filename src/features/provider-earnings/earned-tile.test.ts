import { describe, expect, it } from "vitest";

import type { Money, ProviderEarningsFigures } from "@/interfaces";

import { EARNED_IN_WALLET, callsOfClass, earnedTileSub, earningsSplit, homeUnpaidNotes, unpaidLines } from "./earned-tile";

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

describe("unpaidLines: reason and next step", () => {
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

  it("maps each line to its call class for the drill-down", () => {
    expect(lines.map((l) => l.className)).toEqual(["PAID_BUYER_DEBT", "PAID_UNCOLLECTED", "PROVIDER_FORFEITED"]);
  });

  it("keeps the amounts and counts from the totals", () => {
    expect(lines.map((l) => [l.amount.amount, l.calls])).toEqual([
      ["90000", 1],
      ["180000", 2],
      ["270000", 3],
    ]);
  });

  it("says the buyer's debt and written-off calls need nothing from the provider, and keeps the 30-day deadline", () => {
    expect(lines[0].actionable).toBe(false);
    expect(lines[0].action).toMatch(/^Nothing to do/);
    expect(lines[0].action).toMatch(/30 days/);
    expect(lines[1].actionable).toBe(false);
    expect(lines[1].action).toMatch(/nobody owes it/);
  });

  it("tells the provider how to avoid a forfeit", () => {
    expect(lines[2].actionable).toBe(true);
    expect(lines[2].reason).toMatch(/stake was below the minimum/);
    expect(lines[2].action).toMatch(/stake above the minimum/);
  });

  it("keeps each reason and action to one short sentence or two", () => {
    for (const line of lines) {
      expect(line.reason.length).toBeLessThan(140);
      expect(line.action.length).toBeLessThan(140);
      expect(line.reason).not.toMatch(/\$/);
    }
  });
});

describe("homeUnpaidNotes", () => {
  const hrefs = { money: "/provider/money#passed-not-paid", stake: "/provider/capital" };

  it("is empty when nothing is waiting or forfeited", () => {
    expect(homeUnpaidNotes(totals(), format, hrefs)).toEqual([]);
    expect(homeUnpaidNotes(undefined, format, hrefs)).toEqual([]);
  });

  it("says open buyer debt needs nothing from the provider, and links to the details", () => {
    const [note] = homeUnpaidNotes(totals({ debtOutstanding: usdg("405000"), debtOutstandingCalls: 1 }), format, hrefs);
    expect(note.text).toBe("$0.41 for 1 call is waiting on buyers. It reaches your wallet when they settle; nothing for you to do.");
    expect(note.tone).toBe("neutral");
    expect(note.link.href).toBe(hrefs.money);
    expect(note.text).not.toMatch(/platform (owes|pays)/);
  });

  it("warns about forfeits and links to Stake; written-off calls stay on Money", () => {
    const notes = homeUnpaidNotes(
      totals({ forfeited: usdg("72000"), forfeitedCalls: 2, uncollected: usdg("810000"), uncollectedCalls: 2 }),
      format,
      hrefs,
    );
    expect(notes.map((n) => n.key)).toEqual(["forfeited"]);
    expect(notes[0].tone).toBe("warning");
    expect(notes[0].text).toMatch(/^\$0\.07 for 2 calls was forfeited/);
    expect(notes[0].link).toEqual({ label: "Check your stake", href: hrefs.stake });
  });
});

describe("callsOfClass", () => {
  const row = (classification: string, createdAt: string) => ({ classification, createdAt });
  const rows = [
    row("PAID_BUYER_DEBT", "2026-10-02T00:00:00Z"),
    row("PAID_CREDITED", "2026-10-05T00:00:00Z"),
    row("PAID_BUYER_DEBT", "2026-10-09T00:00:00Z"),
    row("PAID_BUYER_DEBT", "2026-10-04T00:00:00Z"),
  ];

  it("keeps one class, newest first", () => {
    const result = callsOfClass(rows, "PAID_BUYER_DEBT");
    expect(result.items.map((r) => r.createdAt)).toEqual([
      "2026-10-09T00:00:00Z",
      "2026-10-04T00:00:00Z",
      "2026-10-02T00:00:00Z",
    ]);
    expect(result.total).toBe(3);
    expect(result.more).toBe(0);
  });

  it("caps the list and says how many more", () => {
    const result = callsOfClass(rows, "PAID_BUYER_DEBT", 2);
    expect(result.items).toHaveLength(2);
    expect(result.more).toBe(1);
    expect(callsOfClass(rows, "PROVIDER_FORFEITED")).toEqual({ items: [], total: 0, more: 0 });
  });
});
