import { describe, expect, it } from "vitest";

import { penaltyNext, rowFromCase, STATUS_TABS, tabById, type PenaltyRow } from "./penalty-list";

/**
 * B11: "Needs ruling" holds only what the arbiter can rule on (disputed on
 * chain); every row says what comes next and by when, and a penalty not on
 * chain past its computed dates says so.
 */
const NOW = Date.parse("2026-10-18T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function row(partial: Partial<PenaltyRow>): PenaltyRow {
  return {
    id: "p1",
    providerId: "a965eec3-ad93-4257-bf9b-e172361ee56c",
    providerName: "Open-Meteo Demo BV",
    toolName: "get_weather",
    amount: { amount: "28470000", asset: "eip155:46630/erc20:0x1", decimals: 6 },
    status: "PROPOSED",
    proposedAt: iso(NOW - 5 * DAY),
    disputedAt: null,
    nextDeadline: iso(NOW - 2 * DAY),
    onChain: false,
    ...partial,
  };
}

describe("the tabs", () => {
  it("Needs ruling is disputed on chain only", () => {
    expect(tabById(STATUS_TABS, "needs-ruling").statuses).toEqual(["CHAIN_DISPUTED"]);
  });
});

describe("the row's next step", () => {
  it("a penalty not on chain past its computed date says so", () => {
    expect(penaltyNext(row({}), NOW)).toEqual({
      kind: "text",
      text: "Not on chain after 5 days",
      until: null,
      urgent: true,
    });
  });

  it("never 'Executable now' for one not on chain", () => {
    expect(penaltyNext(row({ nextDeadline: iso(NOW + DAY) }), NOW)).toMatchObject({ text: "Waiting to go on chain" });
    expect(penaltyNext(row({ onChain: true }), NOW)).toMatchObject({ text: "Executable now" });
  });


  it("reads onChain from the list, and an older backend as unknown", () => {
    const base = {
      proposalId: "p1",
      providerId: "prov",
      providerName: "Open-Meteo Demo BV",
      toolName: null,
      amount: { amount: "1", asset: "eip155:46630/erc20:0x1", decimals: 6 },
      chainId: "eip155:46630",
      status: "PROPOSED" as const,
      proposedAt: iso(NOW),
      disputedAt: null,
      nextDeadline: null,
    };
    expect(rowFromCase({ ...base, onChain: false }).onChain).toBe(false);
    expect(rowFromCase({ ...base, onChain: true }).onChain).toBe(true);
  });

  it("a cancel past due never claims what stands: the page reads it", () => {
    expect(penaltyNext(row({ status: "CANCEL_REQUESTED", onChain: true, nextDeadline: iso(NOW - DAY) }), NOW)).toMatchObject({
      text: "Cancel overdue · open it to see what stands on chain",
    });
  });
});
