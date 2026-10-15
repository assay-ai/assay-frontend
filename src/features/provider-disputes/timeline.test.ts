import { describe, expect, it } from "vitest";

import type { SlashProposalEvent, SlashProposalSummary } from "@/interfaces/provider-disputes";

import { buildRichTimeline, withAcknowledgedEvent } from "./timeline";

const event = (id: string, kind: string, occurredAt: string): SlashProposalEvent => ({
  id,
  kind,
  occurredAt,
  actorType: "system",
  actorId: null,
  summary: kind,
  detail: {},
});

const proposal = (acknowledgedAt: string | null) =>
  ({ clocks: { acknowledgedAt } }) as unknown as SlashProposalSummary;

const base = [
  event("1", "PROPOSED", "2026-10-10T06:00:00.000Z"),
  event("2", "NOTIFIED", "2026-10-10T06:01:00.000Z"),
];

describe("withAcknowledgedEvent", () => {
  it("adds the ACKNOWLEDGED event when the case is acknowledged but the timeline lags", () => {
    const out = withAcknowledgedEvent(base, proposal("2026-10-10T06:23:00.000Z"));
    expect(out.map((e) => e.kind)).toEqual(["PROPOSED", "NOTIFIED", "ACKNOWLEDGED"]);
  });

  it("does not duplicate an event the endpoint already returned", () => {
    const withAck = [...base, event("3", "ACKNOWLEDGED", "2026-10-10T06:23:00.000Z")];
    expect(withAcknowledgedEvent(withAck, proposal("2026-10-10T06:23:00.000Z"))).toHaveLength(3);
  });

  it("adds nothing before the case is acknowledged", () => {
    expect(withAcknowledgedEvent(base, proposal(null))).toHaveLength(2);
  });
});

// BUG-R16-V4-02: an on-chain case listed the platform's "Our response due".
describe("buildRichTimeline — platform deadline", () => {
  const caseWith = (disputeOnChain: boolean) =>
    ({
      penaltyAmount: { amount: "30000", asset: "x", decimals: 6 },
      toolName: "get_weather",
      bindingId: "b1",
      resolvedAt: null,
      executedAt: null,
      clocks: {
        acknowledgedAt: null,
        disputeOnChain,
        platformDecisionDueAt: "2026-10-16T10:29:00.000Z",
        earliestExecutionAt: "2026-10-17T10:29:00.000Z",
      },
    }) as unknown as SlashProposalSummary;

  it("leaves it out of an on-chain case", () => {
    const labels = buildRichTimeline(base, caseWith(true)).map((row) => row.label);
    expect(labels).not.toContain("Our response due");
    expect(labels).toContain("Earliest possible execution");
  });

  it("keeps it on a case decided in the app", () => {
    const labels = buildRichTimeline(base, caseWith(false)).map((row) => row.label);
    expect(labels).toContain("Our response due");
  });
});
