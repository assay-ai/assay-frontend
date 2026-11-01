import { describe, expect, it } from "vitest";

import { debtStageIntentIds, inEscrowHolds, payingIntentIds } from "./use-open-hold-intent-ids";

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
