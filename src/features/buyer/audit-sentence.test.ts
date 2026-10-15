import { describe, expect, it } from "vitest";

import { auditSentence, dayHeading, groupByDay } from "./audit-sentence";

const entry = (over: Partial<Parameters<typeof auditSentence>[0]>) => ({
  actorType: "user",
  actorId: "me@example.com",
  action: "spend_policy.updated",
  before: null,
  after: null,
  createdAt: "2026-10-16T10:00:00Z",
  ...over,
});

describe("auditSentence", () => {
  it("never puts an email inside a change; only the actor may be named by one", () => {
    const line = auditSentence(
      entry({ actorId: "ops@team.example", before: { dailyCap: "40.00" }, after: { dailyCap: "75.00", changedBy: "ops@team.example" } }),
      () => null,
      "me@example.com",
    ).line;
    expect(line).toBe("ops@team.example changed daily spending limit from $40.00 to $75.00");
  });
  it("says who changed what, from what to what", () => {
    expect(
      auditSentence(entry({ before: { dailyCap: "40.00" }, after: { dailyCap: "75.00" } }), () => null, "me@example.com"),
    ).toEqual({ title: "Spending limits changed", line: "You changed daily spending limit from $40.00 to $75.00" });
  });
  it("names agents and Assay, and never prints raw ids", () => {
    expect(
      auditSentence(
        entry({ actorType: "agent", actorId: "a1", action: "credential.created", after: { agentId: "5b8e1c02-7a34-4d96-8f10-c6e3b92d7f45" } }),
        (id) => (id === "a1" ? "research-agent" : null),
      ).line,
    ).toBe("research-agent created an agent key");
    expect(auditSentence(entry({ actorType: "system", actorId: null, after: { maxCallsPerMinute: 30 } }), () => null).line).toBe(
      "Assay set calls per minute limit to 30",
    );
  });
  it("says refunds, sign-ins and revocations as sentences, with no raw keys", () => {
    const refund = auditSentence(
      entry({ actorType: "system", actorId: null, action: "payment_intent.refunded", before: { charged: "6.00" }, after: { charged: "0.00" } }),
      () => null,
    );
    expect(refund.title).toBe("Refund: $6.00 not charged");
    expect(refund.line).toMatch(/failed our checks/);
    const session = auditSentence(
      entry({ actorType: "agent", actorId: "a1", action: "session.created", after: { credential: "assay_live_31ac" } }),
      () => "prod",
    );
    expect(session.title).toBe("Agent connected");
    expect(session.line).not.toMatch(/assay_live_/);
    expect(auditSentence(entry({ action: "session.created" }), () => null, "me@example.com").title).toBe("Signed in");
    const revoked = auditSentence(
      entry({ action: "credential.revoked", before: { name: "CI deploy", revokedAt: null }, after: { name: "CI deploy", revokedAt: "immediately" } }),
      () => null,
      "me@example.com",
    );
    expect(revoked).toEqual({ title: "Agent key revoked", line: "You revoked the agent key “CI deploy”; it stopped working immediately" });
  });
});

describe("day grouping", () => {
  it("labels today and yesterday and keeps order", () => {
    const now = new Date(2026, 9, 16, 12);
    expect(dayHeading(new Date(2026, 9, 16, 1).toISOString(), now)).toBe("Today");
    expect(dayHeading(new Date(2026, 9, 15, 23).toISOString(), now)).toBe("Yesterday");
    const groups = groupByDay(
      [
        { createdAt: new Date(2026, 9, 16, 9).toISOString() },
        { createdAt: new Date(2026, 9, 16, 8).toISOString() },
        { createdAt: new Date(2026, 9, 12, 8).toISOString() },
      ],
      now,
    );
    expect(groups.map((g) => [g.day, g.entries.length])).toEqual([
      ["Today", 2],
      ["Mon 12 Oct", 1],
    ]);
  });
});
