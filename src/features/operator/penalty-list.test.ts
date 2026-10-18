import { describe, expect, it } from "vitest";

import { penaltyNext, rowFromCase, STATUS_TABS, tabById, tabCounts, type PenaltyRow } from "./penalty-list";

/**
 * B11: "Needs ruling" holds only what the arbiter can rule on (disputed on
 * chain); old-process rows wait under their own tab; every row says what
 * comes next and by when, and a penalty not on chain past its computed dates
 * says so.
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
  it("Needs ruling is disputed on chain only; Old process holds the retired objection rows", () => {
    expect(tabById(STATUS_TABS, "needs-ruling").statuses).toEqual(["CHAIN_DISPUTED"]);
    expect(tabById(STATUS_TABS, "old-process")).toMatchObject({ label: "Old process", statuses: ["DISPUTED"] });
  });

  it("the seed's three old-process rows are not counted as needing a ruling", () => {
    const counts = tabCounts([row({ status: "DISPUTED" }), row({ status: "DISPUTED" }), row({ status: "DISPUTED" })]);
    expect(counts["needs-ruling"]).toBe(0);
    expect(counts["old-process"]).toBe(3);
  });
});

describe("the row's next step", () => {
  it("a penalty not on chain past its computed date says so", () => {
    expect(penaltyNext(row({}), NOW)).toEqual({
      kind: "text",
      text: "Not on chain after 5 days · suspend it if it should not stand",
      until: null,
      urgent: true,
    });
  });

  it("never 'Executable now' for one not on chain", () => {
    expect(penaltyNext(row({ nextDeadline: iso(NOW + DAY) }), NOW)).toMatchObject({ text: "Waiting to go on chain" });
    expect(penaltyNext(row({ onChain: true }), NOW)).toMatchObject({ text: "Executable now" });
  });

  it("an old-process row names its next step and deadline", () => {
    expect(penaltyNext(row({ status: "DISPUTED" }), NOW)).toMatchObject({
      text: "Old process · not on chain after 5 days · suspend it from its page",
      urgent: true,
    });
    expect(penaltyNext(row({ status: "DISPUTED", onChain: true, nextDeadline: iso(NOW + 30 * 3_600_000) }), NOW)).toMatchObject({
      text: "Old process · decide within 30h",
      urgent: false,
    });
    expect(penaltyNext(row({ status: "DISPUTED", onChain: true, nextDeadline: iso(NOW - 1) }), NOW)).toMatchObject({
      text: "Old process · decision overdue",
      urgent: true,
    });
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
    expect(rowFromCase(base).onChain).toBeNull();
  });
});
