import { describe, expect, it } from "vitest";

import { debtStageIntentIds, payingIntentIds } from "./use-open-hold-intent-ids";

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
