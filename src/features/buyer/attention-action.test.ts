import { describe, expect, it } from "vitest";

import { attentionAction } from "./attention-action";

describe("attentionAction", () => {
  it("gives each actionable event one verb and a place to act", () => {
    expect(attentionAction({ event: "balance.low" })).toEqual({ label: "Top up", href: "/funding/deposit" });
    expect(attentionAction({ event: "spend.threshold_crossed" })?.label).toBe("Raise limit");
    expect(attentionAction({ event: "velocity.anomaly" })?.label).toBe("Review agent");
    expect(attentionAction({ event: "payment_intent.refunded", subjectId: "i1" })?.href).toBe("/receipts/view?id=i1");
  });
  it("offers nothing for events with nothing to do", () => {
    expect(attentionAction({ event: "digest.daily" })).toBeNull();
  });
});
