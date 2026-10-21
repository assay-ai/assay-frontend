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
  it("says policy amounts in dollars and times in UTC, without version counters", () => {
    expect(
      auditSentence(
        entry({
          before: { perCallMax: "400000", dailyCap: "370000", policyVersion: 3 },
          after: { perCallMax: "500000", dailyCap: "10000000", changeReason: "restore", policyVersion: 4 },
        }),
        () => null,
        "me@example.com",
      ).line,
    ).toBe("You changed per call max from $0.40 to $0.50, and changed daily spending limit from $0.37 to $10.00");
    expect(
      auditSentence(
        entry({ action: "signer.authorized", after: { validUntil: "2026-11-19T10:34:47.000Z", maxPerWindow: "5000000" } }),
        () => null,
        "me@example.com",
      ).line,
    ).toBe("You set end date to Nov 19, 10:34 UTC, and set max per window to $5.00");
  });
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
      entry({ actorType: "agent", actorId: "a1", action: "session.created", after: { credential: "assay_sk_live_31ac" } }),
      () => "prod",
    );
    expect(session.title).toBe("Agent connected");
    expect(session.line).not.toMatch(/assay_sk_live_/);
    expect(auditSentence(entry({ action: "session.created" }), () => null, "me@example.com").title).toBe("Signed in");
    const revoked = auditSentence(
      entry({ action: "credential.revoked", before: { name: "CI deploy", revokedAt: null }, after: { name: "CI deploy", revokedAt: "immediately" } }),
      () => null,
      "me@example.com",
    );
    expect(revoked).toEqual({ title: "Agent key revoked", line: "You revoked the agent key “CI deploy”; it stopped working immediately" });
  });
});

describe("auditSentence — You, past tense, tool set, no raw ids (review F-P1)", () => {
  it("says You for the signed-in person, whose entries carry a session id, not an email", () => {
    const line = auditSentence(
      entry({ actorId: "cred_9f2c1a7b", action: "credential.created", after: { name: "ux-review-key" } }),
      () => null,
      "me@example.com",
    ).line;
    expect(line).toBe("You created the agent key “ux-review-key”");
    expect(auditSentence(entry({ actorId: "5b8e1c02-7a34-4d96-8f10-c6e3b92d7f45" }), () => null, null).line).toBe("By you");
  });

  it("says a report in words: the reason label, and whether a refund is guaranteed", () => {
    const filed = auditSentence(
      entry({ actorId: "cred_1", action: "call_dispute.filed", after: { intentId: "int_1", reason: "OTHER", refundGuaranteed: false } }),
      () => null,
    );
    expect(filed).toEqual({
      title: "Bad result reported",
      line: "You reported a bad result on a call (reason: something else); reported after the refund window, so a refund is not guaranteed",
    });
    expect(filed.line).not.toMatch(/OTHER|int_1|refund guaranteed to/);
  });

  it("writes tool set, never Toolset, and never a list of ids", () => {
    const replaced = auditSentence(
      entry({ action: "toolset.entries_replaced", after: { toolIds: ["5b8e1c02-7a34-4d96-8f10-c6e3b92d7f45"] } }),
      () => null,
      "me@example.com",
    );
    expect(replaced).toEqual({ title: "Tool set tools changed", line: "You changed which tools are in a tool set; it now has 1 tool" });
    expect(auditSentence(entry({ action: "toolset.created", after: { slug: "research", name: "Research", toolCount: 3 } }), () => null, "me@example.com").line).toBe(
      "You created the tool set “Research” with 3 tools",
    );
    expect(auditSentence(entry({ action: "toolset.updated", before: { name: "A" }, after: { name: "B" } }), () => null, "me@example.com").line).toBe(
      "You renamed the tool set “A” to “B”",
    );
    expect(auditSentence(entry({ action: "toolset.something_new" }), () => null, "me@example.com").title).not.toMatch(/Toolset/);
    expect(auditSentence(entry({ action: "spend_policy.updated", after: { allowedToolIds: ["t1"] } }), () => null, "me@example.com").line).toBe("By you");
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

describe("agent.renamed", () => {
  it("says who renamed which agent, from and to", () => {
    const line = auditSentence(
      entry({ actorId: "cred_9f2c1a7b", action: "agent.renamed", before: { label: "My agent" }, after: { label: "Research bot" } }),
      () => null,
      "me@example.com",
    ).line;
    expect(line).toBe("You renamed the agent “My agent” to “Research bot”");
  });
});

describe("money events (B7)", () => {
  it("deposits and withdrawals read as sentences, in dollars at two places", () => {
    const me = "me@example.com";
    expect(
      auditSentence(entry({ actorType: "system", actorId: "deposit-finality", action: "deposit.credited", after: { amount: "25.000000", amountAtomic: "25000000" } }), () => null, me),
    ).toEqual({ title: "Deposit: $25.00 added", line: "Your deposit reached your balance and can pay for calls" });
    expect(
      auditSentence(entry({ action: "withdrawal.requested", actorId: me, after: { amount: "13.240000" } }), () => null, me),
    ).toEqual({
      title: "Withdrawal: $13.24 requested",
      line: "You asked to withdraw up to $13.24 from the escrow; paid calls on that chain pause until it is claimed or cancelled",
    });
    expect(auditSentence(entry({ action: "withdrawal.cancelled", actorId: me, after: { amount: "0.000000" } }), () => null, me).title).toBe(
      "Withdrawal cancelled",
    );
    expect(
      auditSentence(entry({ actorType: "system", actorId: "escrow-withdrawal-index", action: "withdrawal.claimed", after: { amount: "13.000000" } }), () => null, me),
    ).toEqual({ title: "Withdrawal: $13.00 claimed", line: "$13.00 left the escrow for your wallet" });
  });
  it("keeps a sub-cent amount's digits", () => {
    expect(auditSentence(entry({ action: "deposit.credited", after: { amount: "0.0045" } }), () => null).title).toBe("Deposit: $0.0045 added");
  });
});
