import { describe, expect, it } from "vitest";

import { collectionView, isCollectionState } from "./receipt-collection";

const listedPrice = { amount: "2500000", asset: "a", decimals: 6 };

describe("collectionView", () => {
  it("knows the four collection states", () => {
    expect(isCollectionState("DEBT_OUTSTANDING")).toBe(true);
    expect(isCollectionState("FORFEITED")).toBe(true);
    expect(isCollectionState("CHARGED")).toBe(false);
  });

  it("heads an open debt with what is owed, why, and what it pauses", () => {
    const view = collectionView("DEBT_OUTSTANDING", { listedPrice, chargeNote: "buyer_debt:DelegateIsRevoked" });
    expect(view.owed).toBe(true);
    expect(view.headline).toBe("You owe $2.50 for this call");
    expect(view.explain).toMatch(/Paid calls are paused until you settle; free calls still work\./);
    expect(view.cause).not.toBeNull();
    expect(view.timeline).toEqual({ label: "Payment not taken yet: you owe it", meta: "$2.50 still held in your escrow" });
  });

  it("says a written-off debt is still owed and unpaid to the provider, without jargon", () => {
    const view = collectionView("DEBT_WRITTEN_OFF", { listedPrice, chargeNote: null });
    expect(view.headline).toBe("You still owe $2.50 for this call");
    expect(view.explain).toMatch(/provider was not paid/);
    expect(view.timeline.meta).toBe("$2.50 still owed by you");
    expect(view.cause).toBeNull();
  });

  it("says a voided debt or a forfeit costs nothing, and never says 'Closed, not collected'", () => {
    for (const state of ["DEBT_VOIDED", "FORFEITED"] as const) {
      const view = collectionView(state, { listedPrice, chargeNote: null });
      expect(view.owed).toBe(false);
      expect(view.headline).toMatch(/^Not charged/);
      expect(view.timeline.label).not.toMatch(/Closed, not collected/);
      expect(view.timeline.meta).toBe("not charged");
    }
  });
});
