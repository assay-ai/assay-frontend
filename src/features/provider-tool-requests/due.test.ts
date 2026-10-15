import { describe, expect, it } from "vitest";

import { compactDuration, replyBadge } from "./due";

const NOW = Date.parse("2026-10-16T12:00:00Z");

describe("replyBadge", () => {
  it("counts down to the first reply", () => {
    expect(replyBadge({ status: "OPEN", firstResponseDueAt: "2026-10-18T12:00:00Z", firstRespondedAt: null }, NOW)).toEqual({
      label: "Reply due in 2d",
      tone: "neutral",
    });
    expect(replyBadge({ status: "OPEN", firstResponseDueAt: "2026-10-16T18:00:00Z", firstRespondedAt: null }, NOW)?.tone).toBe("warning");
  });

  it("says overdue after the deadline", () => {
    expect(replyBadge({ status: "OPEN", firstResponseDueAt: "2026-10-16T03:00:00Z", firstRespondedAt: null }, NOW)).toEqual({
      label: "Overdue 9h",
      tone: "danger",
    });
  });

  it("disappears once replied or closed", () => {
    expect(replyBadge({ status: "ACKNOWLEDGED", firstResponseDueAt: "2026-10-16T03:00:00Z", firstRespondedAt: "2026-10-15T00:00:00Z" }, NOW)).toBeNull();
    expect(replyBadge({ status: "DECLINED", firstResponseDueAt: "2026-10-16T03:00:00Z", firstRespondedAt: null }, NOW)).toBeNull();
  });

  it("keeps durations short", () => {
    expect(compactDuration(30 * 60_000)).toBe("30m");
    expect(compactDuration(47 * 3_600_000)).toBe("47h");
  });
});
