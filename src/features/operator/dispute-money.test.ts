import { describe, expect, it } from "vitest";

import { collectionLabel } from "./dispute-money";

const intent = (refundPlan: string | null, collectionState = "NORMAL") => ({ refundPlan, collectionState });

describe("collectionLabel", () => {
  it("RELEASE_HELD by dispute state", () => {
    expect(collectionLabel(intent("RELEASE_HELD"), "OPEN")).toBe("Held: not the provider's until decided");
    expect(collectionLabel(intent("RELEASE_HELD"), "UPHELD")).toBe("Held: being refunded to the buyer");
    expect(collectionLabel(intent("RELEASE_HELD"), "REJECTED")).toBe("Held: goes to the provider when the hold ends");
    expect(collectionLabel(intent("RELEASE_HELD"), "WITHDRAWN")).toBe("Held: goes to the provider when the hold ends");
  });

  it("COLLECTION_IN_PROGRESS by dispute state", () => {
    expect(collectionLabel(intent("COLLECTION_IN_PROGRESS"), "REJECTED")).toBe("Held: being collected for the provider");
    expect(collectionLabel(intent("COLLECTION_IN_PROGRESS"), "WITHDRAWN")).toBe("Held: being collected for the provider");
    expect(collectionLabel(intent("COLLECTION_IN_PROGRESS"), "OPEN")).toBe("Payment is moving right now");
    expect(collectionLabel(intent("COLLECTION_IN_PROGRESS"), "UPHELD")).toBe("Payment is moving right now");
  });

  it("ALREADY_REFUNDED in every state", () => {
    for (const state of ["OPEN", "UPHELD", "REJECTED", "WITHDRAWN"]) {
      expect(collectionLabel(intent("ALREADY_REFUNDED"), state)).toBe("Refunded to the buyer (or the debt cancelled)");
    }
  });

  it("COLLECTED, NOT_CHARGED, VOID_DEBT and no plan fall back to the collection state", () => {
    expect(collectionLabel(intent("COLLECTED"), "OPEN")).toBe("Collected for the provider");
    expect(collectionLabel(intent("NOT_CHARGED", "VOIDED"), "UPHELD")).toBe("Voided (not charged)");
    expect(collectionLabel(intent("NOT_CHARGED", "PROVIDER_FORFEITED"), "UPHELD")).toBe("Provider forfeited (buyer not charged)");
    expect(collectionLabel(intent("VOID_DEBT", "DEBT_OUTSTANDING"), "OPEN")).toBe("Buyer owes it (debt)");
    expect(collectionLabel(intent(null, "WRITTEN_OFF"), "REJECTED")).toBe("Written off (provider unpaid)");
    expect(collectionLabel(intent(null, "SOMETHING_NEW"), "OPEN")).toBe("SOMETHING_NEW");
  });
});
