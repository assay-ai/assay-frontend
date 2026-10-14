import type { HexString } from "@/libs/chains/evm/stake-slashes/address";
import { describe, expect, it } from "vitest";

import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import { slashRecordStatusOf, slashStatusOf } from "@/libs/chains/evm/stake-slashes/status";

import { DEFAULT_FILTERS, applyFilters, attentionCount, compareRows } from "./filters";

const NOW = 10_000_000;
const DAY = 86_400;

function row(id: string, status: number, opts: Partial<ChainSlashRow> = {}): ChainSlashRow {
  return {
    requestId: `0x${id.padStart(64, "0")}` as HexString,
    status: slashStatusOf(status),
    cancelReason: null,
    penalty: BigInt(1),
    reserved: BigInt(1),
    applied: null,
    beneficiary: "0x64fecbe18e8998cb2990bce631a042f8e2be1659" as HexString,
    proposedAt: NOW - DAY,
    executableAt: NOW + 2 * DAY,
    disputedAt: null,
    disputeExpiresAt: null,
    upheld: false,
    upheldAt: null,
    upheldTx: null,
    disputeTx: null,
    proposeTx: null,
    closeTx: null,
    stateSource: "record",
    ...opts,
  };
}

const ROWS = [
  row("a1", 1, { executableAt: NOW + 3 * DAY }),
  row("a2", 4, { executableAt: NOW + DAY }),
  row("a3", 2, { executableAt: NOW - 10 * DAY, proposedAt: NOW - 13 * DAY }),
  row("a4", 3, { executableAt: NOW - 40 * DAY, proposedAt: NOW - 43 * DAY }),
  row("a5", 1, { executableAt: NOW + 2 * DAY, beneficiary: "0xd30814fd3916fc7fc6ea87d4c429f7b0b7cc4d1d" as HexString }),
];

const ids = (rows: ChainSlashRow[]) => rows.map((r) => r.requestId.slice(-2));

describe("applyFilters", () => {
  it("defaults to Needs attention: Pending and Disputed, soonest executable first", () => {
    expect(DEFAULT_FILTERS.status).toBe("attention");
    expect(ids(applyFilters(ROWS, DEFAULT_FILTERS, NOW))).toEqual(["a2", "a5", "a1"]);
  });

  it("includes an unknown status under Needs attention", () => {
    const rows = [...ROWS, row("a6", 9, { executableAt: NOW })];
    expect(ids(applyFilters(rows, DEFAULT_FILTERS, NOW))).toContain("a6");
  });

  it("filters to one status", () => {
    expect(ids(applyFilters(ROWS, { ...DEFAULT_FILTERS, status: "executed" }, NOW))).toEqual(["a3"]);
    expect(ids(applyFilters(ROWS, { ...DEFAULT_FILTERS, status: "cancelled" }, NOW))).toEqual(["a4"]);
    expect(ids(applyFilters(ROWS, { ...DEFAULT_FILTERS, status: "disputed" }, NOW))).toEqual(["a2"]);
    expect(ids(applyFilters(ROWS, { ...DEFAULT_FILTERS, status: "pending" }, NOW))).toEqual(["a5", "a1"]);
  });

  it("puts open penalties before history under All", () => {
    expect(ids(applyFilters(ROWS, { ...DEFAULT_FILTERS, status: "all" }, NOW))).toEqual(["a2", "a5", "a1", "a4", "a3"]);
  });

  it("filters by when the penalty was proposed", () => {
    const all = { ...DEFAULT_FILTERS, status: "all" as const };
    expect(ids(applyFilters(ROWS, { ...all, range: "7d" }, NOW))).toEqual(["a2", "a5", "a1"]);
    expect(ids(applyFilters(ROWS, { ...all, range: "30d" }, NOW))).toEqual(["a2", "a5", "a1", "a3"]);
    expect(ids(applyFilters(ROWS, { ...all, range: "90d" }, NOW))).toHaveLength(5);
  });

  it("searches the request id and the beneficiary, with or without 0x, any case", () => {
    const all = { ...DEFAULT_FILTERS, status: "all" as const };
    expect(ids(applyFilters(ROWS, { ...all, query: "A3" }, NOW))).toEqual(["a3"]);
    expect(ids(applyFilters(ROWS, { ...all, query: "0xD30814" }, NOW))).toEqual(["a5"]);
    expect(ids(applyFilters(ROWS, { ...all, query: "  " }, NOW))).toHaveLength(5);
    expect(ids(applyFilters(ROWS, { ...all, query: "zzz" }, NOW))).toEqual([]);
  });

  it("combines the filters", () => {
    expect(ids(applyFilters(ROWS, { status: "attention", range: "7d", query: "a1" }, NOW))).toEqual(["a1"]);
  });

  it("does not reorder its input", () => {
    const copy = [...ROWS];
    applyFilters(ROWS, { ...DEFAULT_FILTERS, status: "all" }, NOW);
    expect(ROWS).toEqual(copy);
  });
});

describe("compareRows", () => {
  it("breaks a tie on executableAt by request id, so the order is stable", () => {
    const a = row("b1", 1, { executableAt: NOW });
    const b = row("b2", 1, { executableAt: NOW });
    expect(compareRows(a, b)).toBeLessThan(0);
    expect(compareRows(b, a)).toBeGreaterThan(0);
  });
});

describe("attentionCount", () => {
  it("counts Pending and Disputed", () => {
    expect(attentionCount(ROWS)).toBe(3);
  });
});

describe("filters with an upheld record", () => {
  const upheld = { ...row("b1", 1, { disputedAt: NOW - DAY, upheld: true }), status: slashRecordStatusOf(1, true) };
  const rows = [...ROWS, upheld];

  it("needs attention and counts in the header", () => {
    expect(ids(applyFilters(rows, DEFAULT_FILTERS, NOW))).toContain("b1");
    expect(attentionCount(rows)).toBe(attentionCount(ROWS) + 1);
  });

  it("is listed under Pending, which it still is on chain, and alone under Upheld", () => {
    expect(ids(applyFilters(rows, { ...DEFAULT_FILTERS, status: "pending" }, NOW))).toContain("b1");
    expect(ids(applyFilters(rows, { ...DEFAULT_FILTERS, status: "upheld" }, NOW))).toEqual(["b1"]);
  });
});
