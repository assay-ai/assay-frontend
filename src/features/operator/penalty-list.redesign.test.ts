import { describe, expect, it } from "vitest";

import type { OperatorCaseListRow } from "@/interfaces/operator";
import { demoResponse } from "@/libs/demo/demo-api";

import {
  durationLeft,
  OPEN_STATUSES,
  defaultTab,
  penaltyChip,
  penaltyNext,
  rowFromCase,
  rowMatches,
  STATUS_TABS,
  tabById,
  tabCounts,
  waitingText,
  type PenaltyRow,
} from "./penalty-list";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86_400_000;

function row(partial: Partial<PenaltyRow>): PenaltyRow {
  return {
    id: "p1",
    providerId: "prov",
    providerName: "Northwind Geo",
    toolName: "Northwind geocode",
    amount: { amount: "28470000", asset: "eip155:46630/erc20:0x1", decimals: 6 },
    status: "CHAIN_DISPUTED",
    proposedAt: "2026-09-21T08:09:00Z",
    disputedAt: "2026-09-23T10:00:00Z",
    nextDeadline: "2026-10-23T10:00:00Z",
    onChain: true,
    ...partial,
  };
}

describe("Penalties tabs", () => {
  it("covers every status once across the status tabs, and All asks for every status", () => {
    const named = STATUS_TABS.flatMap((tab) => tab.statuses ?? []);
    expect(new Set(named).size).toBe(named.length);
    expect(named.sort()).toEqual(
      ["CANCELLED", "CANCEL_REQUESTED", "CHAIN_DISPUTED", "COMPENSATED", "DISPUTED", "EXECUTED", "EXPIRED", "PROPOSED"].sort(),
    );
    expect(tabById(STATUS_TABS, "all").statuses).toBeNull();
  });

  it("falls back to the first tab for an unknown id", () => {
    expect(tabById(STATUS_TABS, "nope").id).toBe("needs-ruling");
    expect(tabById(STATUS_TABS, null).id).toBe("needs-ruling");
  });

  it("counts only the open tabs", () => {
    const counts = tabCounts([
      row({ status: "CHAIN_DISPUTED" }),
      row({ status: "DISPUTED" }),
      row({ status: "CANCEL_REQUESTED" }),
      row({ status: "PROPOSED" }),
      row({ status: "PROPOSED" }),
    ]);
    // B11: an old-process DISPUTED row is not a ruling; it waits under "Old process".
    expect(counts).toEqual({ "needs-ruling": 1, signature: 1, "old-process": 1, window: 2 });
    expect(OPEN_STATUSES).not.toContain("EXECUTED");
  });
});

describe("what a row says", () => {
  it("reads a dispute as the shared dispute deadline", () => {
    expect(penaltyNext(row({}), NOW)).toEqual({ kind: "dispute", until: "2026-10-23T10:00:00Z", from: "2026-09-23T10:00:00Z" });
  });

  it("says when an undisputed penalty becomes executable, and when it already is", () => {
    expect(penaltyNext(row({ status: "PROPOSED", disputedAt: null, nextDeadline: new Date(NOW + 2 * DAY).toISOString() }), NOW)).toMatchObject({
      text: "Executable in 2 days",
    });
    expect(penaltyNext(row({ status: "PROPOSED", nextDeadline: new Date(NOW - 1).toISOString() }), NOW)).toMatchObject({ text: "Executable now" });
  });

  it("marks a cancel to sign urgent in its last day", () => {
    const soon = penaltyNext(row({ status: "CANCEL_REQUESTED", nextDeadline: new Date(NOW + 5 * 3_600_000).toISOString() }), NOW);
    expect(soon).toMatchObject({ kind: "text", text: "Arbiter signs the cancel · 5h left", urgent: true });
    const later = penaltyNext(row({ status: "CANCEL_REQUESTED", nextDeadline: new Date(NOW + 3 * DAY).toISOString() }), NOW);
    expect(later).toMatchObject({ urgent: false });
  });

  it("has nothing next once closed", () => {
    for (const status of ["EXECUTED", "CANCELLED", "COMPENSATED", "EXPIRED"] as const) {
      expect(penaltyNext(row({ status, nextDeadline: null }), NOW)).toEqual({ kind: "none" });
    }
  });

  it("never shows Disputed in the lime 'positive' sense for a cancel, and names an upheld one", () => {
    expect(penaltyChip(row({ status: "CANCEL_REQUESTED" }), NOW)).toEqual({ status: "waiting-signature" });
    expect(penaltyChip(row({ status: "PROPOSED", disputedAt: "2026-10-01T00:00:00Z" }), NOW)).toEqual({ status: "upheld" });
    expect(penaltyChip(row({ status: "COMPENSATED" }), NOW)).toEqual({ status: "closed", detail: "paid back" });
  });

  it("filters by provider or tool, case-insensitively", () => {
    expect(rowMatches(row({}), "north")).toBe(true);
    expect(rowMatches(row({}), "GEOCODE")).toBe(true);
    expect(rowMatches(row({}), "tidewater")).toBe(false);
    expect(rowMatches(row({}), "  ")).toBe(true);
  });

  it("names who a waiting request needs", () => {
    expect(waitingText(["Riley Brooks", "Iris Park"])).toBe("Waiting for Riley or Iris to approve");
    expect(waitingText([])).toBe("Waiting for approval");
  });

  it("tells one story in Status and Next while a request waits", () => {
    expect(penaltyChip(row({ status: "PROPOSED", disputedAt: "2026-10-01T00:00:00Z" }), NOW, "slash.suspend")).toEqual({
      status: "upheld",
      detail: "suspend pending",
    });
    expect(penaltyChip(row({ status: "EXECUTED" }), NOW, "slash.compensated")).toEqual({ status: "executed", detail: "pay-back pending" });
    expect(penaltyChip(row({ status: "EXECUTED" }), NOW, null)).toEqual({ status: "executed" });
  });

  it("opens on Needs ruling for who can rule, on All for everyone else", () => {
    expect(defaultTab(true)).toBe("needs-ruling");
    expect(defaultTab(false)).toBe("all");
  });

  it("rounds time left up, in whole units", () => {
    expect(durationLeft(30_000)).toBe("under a minute");
    expect(durationLeft(45 * 60_000)).toBe("45 min");
    expect(durationLeft(17 * 3_600_000 + 1)).toBe("17h");
    // The page's "in 3h 57m" is "3h" here, not "4h".
    expect(durationLeft(3 * 3_600_000 + 57 * 60_000)).toBe("3h");
    expect(durationLeft(7 * DAY)).toBe("7 days");
  });
});

describe("the demo list", () => {
  it("answers GET /operator/cases next deadline first, filtered by status", () => {
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const all = demoResponse("GET", "/operator/cases", {}) as { items: OperatorCaseListRow[] };
      const statuses = new Set(all.items.map((r) => r.status));
      for (const status of ["CHAIN_DISPUTED", "CANCEL_REQUESTED", "PROPOSED", "EXECUTED", "CANCELLED", "COMPENSATED", "EXPIRED"]) {
        expect(statuses.has(status as never)).toBe(true);
      }
      const deadlines = all.items.map((r) => (r.nextDeadline ? Date.parse(r.nextDeadline) : Infinity));
      expect([...deadlines].sort((a, b) => a - b)).toEqual(deadlines);

      const disputed = demoResponse("GET", "/operator/cases", { status: "CHAIN_DISPUTED" }) as { items: OperatorCaseListRow[] };
      expect(disputed.items.length).toBeGreaterThan(0);
      expect(disputed.items.every((r) => r.status === "CHAIN_DISPUTED")).toBe(true);
      expect(rowFromCase(disputed.items[0]!).id).toBe(disputed.items[0]!.proposalId);
    } finally {
      delete process.env.NEXT_PUBLIC_DEMO_CHAINS;
    }
  });
});
