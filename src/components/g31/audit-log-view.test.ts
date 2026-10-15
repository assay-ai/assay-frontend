import { describe, expect, it } from "vitest";

import { classOf } from "./audit-log-view";

/**
 * The actions the backend's `AuditLogWriter` call sites record (BUG-R2-B4-01).
 * Each must land in a class the filter offers: an entry classed "Other" is
 * reachable only under "all".
 */
describe("classOf", () => {
  it.each([
    ["spend_policy.created", "Policy"],
    ["spend_policy.updated", "Policy"],
    ["limit.updated", "Policy"],
    ["notification_channel.created", "Policy"],
    ["notification_channel.updated", "Policy"],
    ["notification_preference.updated", "Policy"],
    ["credential.created", "Authority"],
    ["credential.revoked", "Authority"],
    ["signer.authorized", "Authority"],
    ["signer.revoked", "Authority"],
  ])("puts %s under %s", (action, expected) => {
    expect(classOf(action)).toBe(expected);
  });

  it("keeps the money events the log may carry later under Money", () => {
    expect(classOf("deposit.credited")).toBe("Money");
    expect(classOf("payment_intent.refunded")).toBe("Money");
  });

  it("classes an unknown action as Other rather than guessing", () => {
    expect(classOf("something.happened")).toBe("Other");
  });
});
