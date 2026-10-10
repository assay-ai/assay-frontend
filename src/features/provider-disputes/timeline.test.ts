import { describe, expect, it } from "vitest";

import type { SlashProposalEvent, SlashProposalSummary } from "@/interfaces/provider-disputes";

import { withAcknowledgedEvent } from "./timeline";

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
