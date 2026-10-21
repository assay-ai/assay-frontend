import { describe, expect, it } from "vitest";

import type { PlatformHealth } from "@/interfaces/operator";

import {
  calmStateBlocker,
  cancelsDue,
  healthIssues,
  lagText,
  needsYouBreakdown,
  needsYouCount,
  needsYouWork,
  oldestCallDisputeDue,
  RECONCILIATION_STALE_SECONDS,
  reconciliationIssues,
  overdueToolRequests,
  staleChainData,
  staleChainSentence,
} from "./inbox";

/**
 * B11: Home is one truth about what needs the operator. Cancels to sign and
 * overdue tool requests count; a stale indexer never reads as "Nothing needs
 * you"; lags read in days and hours.
 */
const NOW = Date.parse("2026-10-18T12:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("needsYouCount and its breakdown", () => {
  it("counts cancels to sign and overdue tool requests", () => {
    expect(needsYouCount(0, 0, true, 0, { cancels: 4, toolRequestsOverdue: 5 })).toBe(9);
    expect(needsYouCount(1, 2, true, 1, { callDisputes: 1, cancels: 4 })).toBe(9);
  });

  it("names them in the breakdown", () => {
    expect(needsYouBreakdown(0, 0, true, 0, { cancels: 4, toolRequestsOverdue: 1 })).toBe("4 cancels to sign · 1 tool request overdue");
    expect(needsYouBreakdown(0, 0, true, 0, { cancels: 1 })).toBeNull();
  });
});

describe("cancelsDue", () => {
  it("counts the overdue ones and titles the section", () => {
    const rows = [{ nextDeadline: iso(NOW - HOUR) }, { nextDeadline: iso(NOW - 2 * HOUR) }, { nextDeadline: iso(NOW + HOUR) }, { nextDeadline: null }];
    expect(cancelsDue(rows, NOW)).toEqual({ count: 4, overdue: 2, title: "Cancels to sign (4, 2 overdue)" });
    expect(cancelsDue([{ nextDeadline: iso(NOW + HOUR) }], NOW).title).toBe("Cancels to sign (1)");
  });
});

describe("overdueToolRequests", () => {
  it("keeps the requests past their answer deadline", () => {
    const rows = [
      { id: "a", firstResponseDueAt: iso(NOW - HOUR) },
      { id: "b", firstResponseDueAt: iso(NOW + HOUR) },
    ];
    expect(overdueToolRequests(rows, NOW).map((row) => row.id)).toEqual(["a"]);
  });
});

describe("oldestCallDisputeDue", () => {
  it("names the open dispute closest to its decision deadline", () => {
    const rows = [
      { state: "OPEN", decisionDueAt: iso(NOW + 71 * HOUR + 10 * 60_000) },
      { state: "OPEN", decisionDueAt: iso(NOW + 80 * HOUR) },
      { state: "UPHELD", decisionDueAt: iso(NOW - 10 * HOUR) },
    ];
    expect(oldestCallDisputeDue(rows, NOW)).toBe("oldest due in 71h");
    expect(oldestCallDisputeDue([{ state: "OPEN", decisionDueAt: iso(NOW - 3 * HOUR) }], NOW)).toBe("oldest overdue by 3h");
    expect(oldestCallDisputeDue([], NOW)).toBeNull();
  });
});

describe("lag and stale chain data", () => {
  it("reads a lag in days and hours, never thousands of minutes", () => {
    expect(lagText(4736 * 60)).toBe("3 d 6 h");
    expect(lagText((3 * 24 + 7) * 3600)).toBe("3 d 7 h");
    expect(lagText(5 * 3600 + 12 * 60)).toBe("5 h 12 min");
    expect(lagText(2 * 3600)).toBe("2 h");
    expect(lagText(12 * 60)).toBe("12 min");
    expect(lagText(20)).toBe("under a minute");
  });

  const chain = (stale: boolean, lagSeconds: number | null) => ({
    chainId: "eip155:46630",
    paused: false,
    arbiter: null,
    slashDelaySeconds: 259_200,
    blockedCount: 0,
    indexedBlock: null,
    headBlock: null,
    lagSeconds,
    stale,
    reconciledAt: null,
  });

  it("is stale when any chain is", () => {
    expect(staleChainData({ chainState: [chain(false, 10)] })).toBeNull();
    expect(staleChainData({ chainState: [chain(true, 3600), chain(true, 7200)] })).toEqual({ lagSeconds: 7200 });
    expect(staleChainData({ chainState: [chain(true, 3600), chain(true, null)] })).toEqual({ lagSeconds: null });
    expect(staleChainData(undefined)).toBeNull();
  });

  it("says Home cannot confirm, with the age", () => {
    expect(staleChainSentence({ lagSeconds: (3 * 24 + 7) * 3600 })).toBe(
      "Can't confirm: chain data is 3 d 7 h old (disputes and rulings may be missing)",
    );
    expect(staleChainSentence({ lagSeconds: null })).toContain("has not caught up");
  });

  it("the health strip reads the lag the same way", () => {
    const health = {
      falsePositiveRate: 0,
      falsePositiveGate: 0.02,
      chainState: [chain(true, 4736 * 60)],
    } as unknown as PlatformHealth;
    expect(healthIssues(health).map((issue) => issue.text)).toEqual(["Chain indexer 3 d 6 h behind"]);
  });
});

describe("Home and the nav badge share one rule", () => {
  it("both build the work the same way, so the counts are equal", () => {
    const base = { reviews: 1, callDisputes: 2, takedowns: 0 };
    const home = needsYouCount(1, 2, true, 1, needsYouWork(base, 4, 5));
    const badge = needsYouCount(1, 2, true, 1, needsYouWork(base, 4, 5));
    expect(home).toBe(badge);
    expect(home).toBe(1 + 2 + 1 + 1 + 2 + 4 + 5);
  });

  it("past one page the cancels title is a floor", () => {
    const rows = Array.from({ length: 100 }, () => ({ nextDeadline: iso(NOW - HOUR) }));
    expect(cancelsDue(rows, NOW, true).title).toBe("Cancels to sign (100+, 100+ overdue)");
  });
});

describe("D16: when Home may not look calm", () => {
  it("stale chain data, or freshness that could not be read, blocks 'Nothing needs you'", () => {
    expect(calmStateBlocker({ stale: { lagSeconds: 7 * 3600 }, unreadable: false })).toBe(
      "Can't confirm: chain data is 7 h old (disputes and rulings may be missing)",
    );
    expect(calmStateBlocker({ stale: null, unreadable: true })).toMatch(/^Can't confirm: chain data freshness could not be read/);
    expect(calmStateBlocker({ stale: null, unreadable: false })).toBeNull();
  });
});

/* Lot 1 D16: operator Home says "All systems normal" only when reconciliation is OK and fresh. */
describe("reconciliationIssues", () => {
  const row = (severity: string, ageSeconds = 60) => ({
    asset: "eip155:46630/erc20:0xabc",
    differenceDisplay: 0,
    severity,
    ageSeconds,
    gate: null,
  });

  it("is quiet when every asset is OK and fresh, and before the rows are read", () => {
    expect(reconciliationIssues([row("OK")])).toEqual([]);
    expect(reconciliationIssues(undefined)).toEqual([]);
  });

  it("names a critical or warning asset, a stale run, no run and an unreadable answer", () => {
    expect(reconciliationIssues([row("CRITICAL")]).map((i) => i.text)).toEqual([
      "Reconciliation critical on eip155:46630: withdrawals are frozen",
    ]);
    expect(reconciliationIssues([row("WARN")], { assetName: () => "Robinhood" }).map((i) => i.text)).toEqual([
      "Reconciliation warning on Robinhood",
    ]);
    expect(reconciliationIssues([row("OK", RECONCILIATION_STALE_SECONDS + 60)]).map((i) => i.text)).toEqual([
      "Reconciliation on eip155:46630 last ran 16 min ago",
    ]);
    expect(reconciliationIssues([]).map((i) => i.id)).toEqual(["recon:none"]);
    expect(reconciliationIssues(undefined, { unreadable: true }).map((i) => i.id)).toEqual(["recon:unreadable"]);
  });
});
