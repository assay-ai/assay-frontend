import { describe, expect, it } from "vitest";

import type { ToolCall } from "@/services/tool-calls.service";

import { callBuckets, reconcileSentence } from "./spend-buckets";
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

  it("counts forfeited, written-off, voided and refunded calls as not charged", () => {
    for (const c of [
      call({ forfeited: true, charged: m("0") }),
      call({ debt: "WRITTEN_OFF", charged: m("0") }),
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
