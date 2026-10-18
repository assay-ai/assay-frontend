import { describe, expect, it } from "vitest";

import { attentionAction } from "./attention-action";

describe("attentionAction", () => {
  it("gives each actionable event one verb and a place to act", () => {
    expect(attentionAction({ event: "balance.low" })).toEqual({ label: "Top up", href: "/funding?action=deposit" });
    expect(attentionAction({ event: "spend.threshold_crossed" })?.label).toBe("Raise limit");
    expect(attentionAction({ event: "velocity.anomaly" })?.label).toBe("Review agent");
    expect(attentionAction({ event: "payment_intent.refunded", subjectId: "i1" })?.href).toBe("/receipts/view?id=i1");
  });
  it("opens the agent the alert is about", () => {
    expect(attentionAction({ event: "velocity.anomaly", subjectType: "agent", subjectId: "a1" })?.href).toBe("/agents?agent=a1");
    expect(attentionAction({ event: "session.expiring", subjectType: "credential", subjectId: "k1", payload: { agentId: "a2" } })).toEqual({
      label: "Renew key",
      href: "/agents?agent=a2",
    });
    expect(attentionAction({ event: "session.expired", subjectType: "credential", subjectId: "k1" })?.href).toBe("/agents");
  });
  it("offers funds only when the free tool falls through to paid calls", () => {
    expect(attentionAction({ event: "free_quota.exhausted", payload: { toolId: "t1", fallThroughToPaid: true } })?.label).toBe("Add funds");
    expect(attentionAction({ event: "free_quota.exhausted", payload: { toolId: "t1", fallThroughToPaid: false } })).toEqual({
      label: "See the tool",
      href: "/explore?tool=t1",
    });
  });
  it("offers nothing for events with nothing to do", () => {
    expect(attentionAction({ event: "digest.daily" })).toBeNull();
  });
});
