import { describe, expect, it } from "vitest";

import { isReplaceable } from "@/features/buyer-debt/debt-copy";

import { DEMO_FIXTURES } from "./fixtures";
import { demoDebt } from "./fixtures-buyer";

describe("the demo buyer debt", () => {
  it("can be signed now: its replaceableAt is in the past", () => {
    const debt = demoDebt();
    expect(debt.replaceableAt).toBeTruthy();
    expect(Date.parse(debt.replaceableAt)).toBeLessThan(Date.now());
    expect(isReplaceable(debt, Date.now())).toBe(true);
    expect(DEMO_FIXTURES.some((fixture) => fixture.match === "/escrow/debts")).toBe(true);
  });
});
