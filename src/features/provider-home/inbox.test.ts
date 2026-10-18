import { describe, expect, it } from "vitest";

import { inboxBreakdown, inboxCount, inboxHeadline, isProviderEvent } from "./inbox";

describe("provider inbox audience", () => {
  it("keeps provider events only", () => {
    expect(isProviderEvent("provider.slash_proposed")).toBe(true);
    expect(isProviderEvent("spend.threshold_crossed")).toBe(false);
    expect(isProviderEvent("payment_intent.refunded")).toBe(false);
    expect(isProviderEvent(undefined)).toBe(false);
  });

  it("counts urgent penalties plus unread provider notices, once each", () => {
    expect(
      inboxCount({
        urgent: [["0xabc", "case-1"]],
        notifications: [
          { event: "provider.slash_proposed", readAt: null, subjectId: "CASE-1" },
          { event: "provider.sla_window_warning", readAt: null, subjectId: "w1" },
          { event: "provider.payout_sent", readAt: "2026-10-01T00:00:00Z" },
          { event: "velocity.anomaly", readAt: null },
        ],
      }),
    ).toBe(2);
  });
});

describe("inboxHeadline", () => {
  it("breaks the badge's number into what it counts", () => {
    const breakdown = inboxBreakdown({
      urgent: [["0xabc", "p1"]],
      notifications: [
        { event: "provider.slash_proposed", readAt: null, subjectId: "p1" },
        { event: "provider.sla_window_warning", readAt: null, subjectId: "b1" },
        { event: "provider.slash_executed", readAt: "2026-10-01T00:00:00Z", subjectId: "p3" },
      ],
    });
    expect(breakdown).toEqual({ penalties: 1, reports: 0, notices: 1 });
    expect(inboxHeadline(breakdown)).toBe("2 new: 1 penalty to decide on, 1 unread notice (marked with a dot).");
    expect(inboxHeadline({ penalties: 0, notices: 0 })).toMatch(/^Nothing new/);
  });
});

describe("call disputes in the provider Inbox", () => {
  it("routes on the payload's role: the provider's side only", () => {
    expect(isProviderEvent("call_dispute.opened", { role: "provider" })).toBe(true);
    expect(isProviderEvent("call_dispute.decided", { role: "provider" })).toBe(true);
    expect(isProviderEvent("call_dispute.decided", { role: "buyer" })).toBe(false);
    expect(isProviderEvent("call_dispute.decided", {})).toBe(false);
    expect(isProviderEvent("call_dispute.responded", { role: "buyer" })).toBe(false);
    expect(isProviderEvent("provider_tool.taken_down")).toBe(true);
  });
});

describe("open reports and folded notices in the badge", () => {
  it("counts a report once, not again through its notice, and a folded run once", () => {
    const breakdown = inboxBreakdown({
      urgent: [],
      reports: ["d1"],
      notifications: [
        { event: "call_dispute.opened", readAt: null, subjectId: "d1", payload: { role: "provider" } },
        { event: "provider.stake_headroom_low", readAt: null, subjectId: "b1", payload: { bindingId: "b1" } },
        { event: "provider.stake_headroom_low", readAt: null, subjectId: "b1", payload: { bindingId: "b1" } },
      ],
      groupKey: (item) => (item.event === "provider.stake_headroom_low" ? `headroom:${item.subjectId}` : null),
    });
    expect(breakdown).toEqual({ penalties: 0, reports: 1, notices: 1 });
    expect(inboxHeadline(breakdown)).toBe("2 new: 1 report to reply to, 1 unread notice (marked with a dot).");
  });
});
