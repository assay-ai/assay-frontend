import { describe, expect, it } from "vitest";

import type { ToolCall } from "@/services/tool-calls.service";

import {
  chargedCallsFromTotals,
  callBuckets,
  chargedFromTotals,
  owedFromTotals,
  reconcileSentence,
  spendBreakdown,
  spentFromTotals,
} from "./spend-buckets";
import type { SummaryFigures } from "./wire";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const m = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

function call(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    intentId: "int_1",
    toolId: "tool_1",
    providerId: "prv_1",
    status: "SETTLED",
    price: m("250000"),
    charged: m("250000"),
    verdict: "PASS",
    createdAt: "2026-10-16T00:00:00.000Z",
    ...overrides,
  } as ToolCall;
}

const amounts = (c: ToolCall) => {
  const b = callBuckets(c);
  return [b.charged.amount, b.notCharged.amount, b.owed.amount, b.inProgress.amount];
};

describe("callBuckets — one call in the summary's buckets (R17b-B-01)", () => {
  it("counts an ordinary settled call as charged", () => {
    expect(amounts(call())).toEqual(["250000", "0", "0", "0"]);
  });

  it("counts an open debt as owed, not charged", () => {
    expect(amounts(call({ debt: "OUTSTANDING" }))).toEqual(["0", "0", "250000", "0"]);
  });

  it("counts a written-off debt as owed: the buyer still owes it (final review M2)", () => {
    expect(amounts(call({ debt: "WRITTEN_OFF", charged: m("0") }))).toEqual(["0", "0", "250000", "0"]);
  });

  it("counts forfeited, voided and refunded calls as not charged", () => {
    for (const c of [
      call({ forfeited: true, charged: m("0") }),
      call({ debt: "VOIDED", charged: m("0") }),
      call({ status: "VOIDED", charged: m("0") }),
      call({ status: "REFUNDED", charged: m("0"), verdict: "FAIL" }),
    ]) {
      expect(amounts(c)).toEqual(["0", "250000", "0", "0"]);
    }
  });

  it("counts an unfinished call as in progress", () => {
    expect(amounts(call({ status: "VERIFYING", charged: m("0") }))).toEqual(["0", "0", "0", "250000"]);
  });
});

describe("reconcileSentence", () => {
  const totals = (over: Partial<SummaryFigures>): SummaryFigures => ({
    calls: 13,
    refundedCalls: 0,
    listedTotal: m("3000000"),
    chargedTotal: m("1500000"),
    withheldTotal: m("750000"),
    notChargedTotal: m("1250000"),
    notChargedCalls: 5,
    freeCalls: 0,
    owedTotal: m("250000"),
    owedCalls: 1,
    inProgressTotal: m("0"),
    inProgressCalls: 0,
    failRate: 0,
    ...over,
  });

  it("adds charged, not charged and owed up to listed", () => {
    const text = reconcileSentence(totals({}));
    expect(text).toMatch(/^Listed \S*3\.00 = \S*1\.50 charged \+ \S*1\.25 not charged \+ \S*0\.25 owed \(not collected yet\)\.$/);
  });

  it("leaves owed and in progress out when there are none, and adds in progress when there is some", () => {
    expect(reconcileSentence(totals({ owedCalls: 0, owedTotal: m("0") }))).not.toContain("owed");
    expect(reconcileSentence(totals({ inProgressCalls: 1, inProgressTotal: m("100000") }))).toContain(
      "in progress",
    );
  });
});

describe("spentFromTotals — charged plus owed (final review M1)", () => {
  it("adds owed to charged", () => {
    expect(spentFromTotals({ chargedTotal: m("1500000"), owedTotal: m("250000") })).toEqual(m("1750000"));
  });

  it("is charged alone when nothing is owed or the backend sends no owed figure", () => {
    expect(spentFromTotals({ chargedTotal: m("1500000") })).toEqual(m("1500000"));
    expect(spentFromTotals({ chargedTotal: m("1500000"), owedTotal: m("0") })).toEqual(m("1500000"));
  });

  it("is null without a charged figure", () => {
    expect(spentFromTotals(undefined)).toBeNull();
    expect(spentFromTotals({ owedTotal: m("250000") })).toBeNull();
  });
});

describe("spendBreakdown", () => {
  const totals = (over: Partial<SummaryFigures>): SummaryFigures => ({
    calls: 13,
    refundedCalls: 0,
    listedTotal: m("3000000"),
    chargedTotal: m("1500000"),
    withheldTotal: m("750000"),
    notChargedTotal: m("1250000"),
    notChargedCalls: 5,
    freeCalls: 0,
    owedTotal: m("250000"),
    owedCalls: 1,
    inProgressTotal: m("0"),
    inProgressCalls: 0,
    failRate: 0,
    ...over,
  });
  it("lists listed, then the parts that add up to it, owed included only when there is some", () => {
    const rows = spendBreakdown(totals({}));
    expect(rows.map((r) => r.key)).toEqual(["listed", "charged", "not-charged", "owed"]);
    expect(rows.find((r) => r.key === "owed")?.amount).toMatch(/0\.25$/);
    expect(spendBreakdown(totals({ owedCalls: 0, owedTotal: m("0") })).map((r) => r.key)).not.toContain("owed");
    expect(spendBreakdown(totals({ inProgressCalls: 1, inProgressTotal: m("100000") })).at(-1)?.key).toBe("in-progress");
  });
});

describe("one meaning of spent (P2-3)", () => {
  const m = (amount: string) => ({ amount, asset: "a", decimals: 6 });
  it("is charged only, with owed beside it", () => {
    expect(chargedFromTotals({ chargedTotal: m("1500000"), owedTotal: m("250000") } as never)).toEqual(m("1500000"));
    expect(owedFromTotals({ owedTotal: m("250000") })).toEqual(m("250000"));
    expect(owedFromTotals({ owedTotal: m("0") })).toBeNull();
    expect(chargedFromTotals(undefined)).toBeNull();
  });
});

describe("chargedCallsFromTotals (Spent today's count matches its amount)", () => {
  it("leaves out owed, not-charged and in-progress calls", () => {
    expect(chargedCallsFromTotals({ calls: 6, owedCalls: 1, notChargedCalls: 0, inProgressCalls: 0 })).toBe(5);
    expect(chargedCallsFromTotals({ calls: 10, owedCalls: 1, notChargedCalls: 2, inProgressCalls: 3 })).toBe(4);
    expect(chargedCallsFromTotals({ calls: 1, owedCalls: 2 })).toBe(0);
    expect(chargedCallsFromTotals(null)).toBe(0);
  });
});
