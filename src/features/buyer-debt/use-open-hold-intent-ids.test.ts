import { describe, expect, it } from "vitest";

import { escrowHeldText, heldSegmentLabel } from "./debt-copy";
import { debtStageIntentIds, heldBesidePending, inEscrowHolds, payingIntentIds } from "./use-open-hold-intent-ids";

describe("payingIntentIds (SPEC-H H-2)", () => {
  it("lists the holds whose call passed and is being paid", () => {
    expect([
      ...payingIntentIds([
        { intentId: "a", stage: "CHECKING" },
        { intentId: "b", stage: "SETTLING" },
      ])!,
    ]).toEqual(["b"]);
    expect(payingIntentIds([])).toEqual(new Set());
  });

  it("is unknown (null) when any hold does not say its stage, so the copy names both", () => {
    expect(payingIntentIds([{ intentId: "a", stage: "SETTLING" }, { intentId: "b" }])).toBeNull();
    expect(payingIntentIds([{ intentId: "a", stage: null }])).toBeNull();
  });
});

describe("hold stage DEBT (round-2 review M10)", () => {
  it("is a known stage, never counted as being paid", () => {
    expect([...payingIntentIds([{ intentId: "a", stage: "DEBT" }, { intentId: "b", stage: "SETTLING" }])!]).toEqual(["b"]);
  });

  it("marks the hold as owed, even before the debts list loads", () => {
    expect([...debtStageIntentIds([{ intentId: "a", stage: "DEBT" }, { intentId: "b", stage: "CHECKING" }])]).toEqual(["a"]);
  });
});

describe("hold stage ON_CHAIN_HOLD (BUG-R2-BUY-01)", () => {
  const holds = [
    { intentId: "a", stage: "CHECKING" as const },
    { intentId: "b", stage: "SETTLING" as const },
    { intentId: "c", stage: "ON_CHAIN_HOLD" as const },
    { intentId: "d", stage: "DEBT" as const },
  ];

  it("is not money in the escrow: left out of the held calls", () => {
    expect(inEscrowHolds(holds).map((hold) => hold.intentId)).toEqual(["a", "b", "d"]);
  });

  it("is a known stage, never counted as being paid from the escrow", () => {
    expect([...payingIntentIds(holds)!]).toEqual(["b"]);
    expect(payingIntentIds([{ intentId: "c", stage: "ON_CHAIN_HOLD" }])).toEqual(new Set());
  });

  it("leaves an older server's holds (no stage) as they were", () => {
    expect(inEscrowHolds([{ stage: undefined }, { stage: null }])).toHaveLength(2);
  });
});

// BUG-R2-DEV-01: before a channel lane settles, its calls were said twice on Funding: in "Pending
// settlement" and as "held by N calls passed, being paid to the provider".
describe("heldBesidePending (BUG-R2-DEV-01)", () => {
  const usd = (amount: string) => ({ amount, asset: "USDG", decimals: 6 });
  const settling = [
    { intentId: "s1", amount: usd("10000") },
    { intentId: "s2", amount: usd("10000") },
  ];

  it("says the unsettled calls on the pending line only: nothing left for the held line", () => {
    const held = heldBesidePending({ openHolds: usd("20000"), openHoldIntentIds: ["s1", "s2"], settling, pendingShown: true });
    expect(held).toEqual({ amount: usd("0"), intentIds: [], pendingCalls: 2 });
    expect(heldSegmentLabel(held.intentIds, new Set(), new Set(["s1", "s2"]), { pendingSettlementCalls: held.pendingCalls })).toBe("Pending settlement");
  });

  it("keeps the other holds, with their own amount, so held + pending still add up to openHolds", () => {
    const held = heldBesidePending({ openHolds: usd("25000"), openHoldIntentIds: ["c1", "s1", "s2"], settling, pendingShown: true });
    expect(held).toEqual({ amount: usd("5000"), intentIds: ["c1"], pendingCalls: 2 });
    const text = escrowHeldText("$0.005", held.intentIds, new Set(), new Set(["s1", "s2"]));
    expect(text).toBe("$0.005 more is held by 1 call being checked (minutes)");
    expect(text).not.toMatch(/being paid to the provider/);
    expect(heldSegmentLabel(held.intentIds, new Set(), new Set(["s1", "s2"]), { pendingSettlementCalls: 2 })).toBe("Being checked, and pending settlement");
  });

  it("changes nothing without the pending line (older server) or with no settling call", () => {
    const all = ["c1", "s1", "s2"];
    expect(heldBesidePending({ openHolds: usd("25000"), openHoldIntentIds: all, settling, pendingShown: false })).toEqual({ amount: usd("25000"), intentIds: all, pendingCalls: 0 });
    expect(heldBesidePending({ openHolds: usd("5000"), openHoldIntentIds: ["c1"], settling: [], pendingShown: true })).toEqual({ amount: usd("5000"), intentIds: ["c1"], pendingCalls: 0 });
    expect(heldBesidePending({ openHolds: null, openHoldIntentIds: all, settling, pendingShown: true }).amount).toBeNull();
  });

  it("leaves out another chain's settling holds", () => {
    const other = [{ intentId: "s1", amount: { amount: "10000", asset: "USDC", decimals: 6 } }];
    expect(heldBesidePending({ openHolds: usd("10000"), openHoldIntentIds: ["s1"], settling: other, pendingShown: true })).toEqual({ amount: usd("10000"), intentIds: ["s1"], pendingCalls: 0 });
  });

  it("never goes below zero", () => {
    expect(heldBesidePending({ openHolds: usd("5000"), openHoldIntentIds: ["s1"], settling, pendingShown: true }).amount).toEqual(usd("0"));
  });
});
