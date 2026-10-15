import { describe, expect, it } from "vitest";

import { inboxCount, isProviderEvent } from "./inbox";

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
