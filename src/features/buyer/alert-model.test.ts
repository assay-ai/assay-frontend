import { describe, expect, it } from "vitest";

import { alertTitle, groupAlerts, isAlertResolved, isOldLimitAlert, readableBody, type AlertNote } from "./alert-model";

const ASSET = "eip155:46630/erc20:0xdbbc";
const usd = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

function note(over: Partial<AlertNote> = {}): AlertNote {
  return { id: "n1", event: "velocity.anomaly", title: "Unusual call pattern detected", createdAt: "2026-10-13T17:21:54Z", ...over };
}

describe("groupAlerts", () => {
  it("folds the same alert raised twice in one minute, keeping every id", () => {
    const groups = groupAlerts([
      note({ id: "a", subjectId: "ag1", readAt: "2026-10-14T00:00:00Z" }),
      note({ id: "b", subjectId: "ag1", createdAt: "2026-10-13T17:21:52Z" }),
      note({ id: "c", subjectId: "ag1", createdAt: "2026-10-12T16:30:55Z" }),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([["a", "b"], ["c"]]);
    expect(groups[0]!.unread).toBe(true);
  });
  it("keeps alerts about different agents apart", () => {
    expect(groupAlerts([note({ id: "a", subjectId: "ag1" }), note({ id: "b", subjectId: "ag2" })])).toHaveLength(2);
  });
});

describe("readableBody", () => {
  it("drops bodies written with ids, enum codes, ISO times or raw units", () => {
    expect(readableBody("Agent f64b7b6e-0d10-4354-b99d-59063875645c sent the same request repeatedly.")).toBeNull();
    expect(readableBody("hit its PROVIDER_PER_AGENT_DAILY limit for get_weather.")).toBeNull();
    expect(readableBody("Resets 2026-10-14T00:00:00.000Z.")).toBeNull();
    expect(readableBody("has spent 5.000000 of its 5.000000 daily limit (100%).")).toBeNull();
  });
  it("keeps a body written for a person", () => {
    const body = '"My first agent" has spent $5.00 of its $5.00 daily limit (100%). Resets Oct 14, 00:00 UTC.';
    expect(readableBody(body)).toBe(body);
    expect(readableBody("  ")).toBeNull();
  });
});

describe("isAlertResolved", () => {
  const now = Date.parse("2026-10-19T09:00:00Z");
  it("clears a free-quota alert once its reset time has passed", () => {
    const quota = (resetsAt: unknown) => note({ event: "free_quota.exhausted", payload: { resetsAt } });
    expect(isAlertResolved(quota("2026-10-14T00:00:00.000Z"), { now, balances: null })).toBe(true);
    expect(isAlertResolved(quota("2026-10-20T00:00:00.000Z"), { now, balances: null })).toBe(false);
    expect(isAlertResolved(quota(undefined), { now, balances: null })).toBe(false);
  });
  it("clears a low or zero balance alert only once the same asset holds $5.00 or more", () => {
    const low = note({ event: "balance.low", payload: { asset: ASSET } });
    const zero = note({ event: "balance.zero", payload: { asset: ASSET } });
    const funded = [{ asset: ASSET.toUpperCase(), decimals: 6, available: usd("13240000") }];
    const stillLow = [{ asset: ASSET, decimals: 6, available: usd("1000000") }];
    expect(isAlertResolved(low, { now, balances: funded })).toBe(true);
    expect(isAlertResolved(zero, { now, balances: funded })).toBe(true);
    expect(isAlertResolved(zero, { now, balances: stillLow })).toBe(false);
  });
  it("shows the alert when it cannot tell", () => {
    const low = note({ event: "balance.low", payload: { asset: ASSET } });
    expect(isAlertResolved(low, { now, balances: null })).toBe(false);
    expect(isAlertResolved(low, { now, balances: [{ asset: "other", decimals: 6, available: usd("99000000") }] })).toBe(false);
    expect(isAlertResolved(note({ event: "velocity.anomaly" }), { now, balances: [] })).toBe(false);
    expect(isAlertResolved(note({ event: "agent.paused" }), { now, balances: [] })).toBe(false);
  });
});

describe("isOldLimitAlert (stale rule)", () => {
  const band = (scope: string, cap: string, subjectId = "ag1") =>
    note({ event: "spend.threshold_crossed", title: "Daily spend at 100%", subjectId, payload: { scope, cap, asset: ASSET } });
  const policy = { dailyCap: usd("5000000"), monthlyCap: usd("100000000") };

  it("marks an alert whose limit has since changed or been removed", () => {
    const ctx = { policy: { dailyCap: usd("2000000"), monthlyCap: null }, policyAgentId: "ag1", delegation: false };
    expect(isOldLimitAlert(band("daily", "5000000"), ctx)).toBe(true);
    expect(isOldLimitAlert(band("monthly", "100000000"), ctx)).toBe(true);
  });
  it("marks a daily alert of an agent that now has its own on-chain limit", () => {
    expect(isOldLimitAlert(band("daily", "5000000"), { policy, policyAgentId: "ag1", delegation: true })).toBe(true);
    expect(isOldLimitAlert(band("monthly", "100000000"), { policy, policyAgentId: "ag1", delegation: true })).toBe(false);
  });
  it("leaves a current limit, another agent, or an unknown policy unmarked", () => {
    expect(isOldLimitAlert(band("daily", "5000000"), { policy, policyAgentId: "ag1", delegation: false })).toBe(false);
    expect(isOldLimitAlert(band("daily", "1", "ag2"), { policy, policyAgentId: "ag1", delegation: false })).toBe(false);
    expect(isOldLimitAlert(band("daily", "1"), { policy: null, policyAgentId: "ag1", delegation: false })).toBe(false);
    expect(isOldLimitAlert(note(), { policy, policyAgentId: "ag1", delegation: true })).toBe(false);
  });
  it("says so in the title", () => {
    expect(alertTitle("Daily spend at 100%", true)).toBe("Daily spend at 100% (old limit)");
    expect(alertTitle("Daily spend at 100%", false)).toBe("Daily spend at 100%");
  });
});
