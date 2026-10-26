import { describe, expect, it } from "vitest";

import { changePercent, paidGroups, previousTotal, rankRows, spendCsv, spendCsvFilename } from "./spend-view";
import type { SummaryGroup } from "./wire";

const m = (amount: string) => ({ amount, asset: "eip155:1/erc20:0x1", decimals: 6 });

function group(key: string, listed: string, charged: string, calls = 10, prevCharged?: string): SummaryGroup {
  const withheld = String(BigInt(listed) - BigInt(charged));
  return {
    key,
    calls,
    refundedCalls: withheld === "0" ? 0 : 1,
    listedTotal: m(listed),
    chargedTotal: m(charged),
    withheldTotal: m(withheld),
    notChargedTotal: m(withheld),
    notChargedCalls: withheld === "0" ? 0 : 1,
    owedTotal: m("0"),
    owedCalls: 0,
    inProgressTotal: m("0"),
    inProgressCalls: 0,
    freeCalls: 0,
    failRate: null,
    comparison: prevCharged
      ? {
          calls: 5,
          refundedCalls: 0,
          listedTotal: m(prevCharged),
          chargedTotal: m(prevCharged),
          withheldTotal: m("0"),
          notChargedTotal: m("0"),
          notChargedCalls: 0,
          owedTotal: m("0"),
          owedCalls: 0,
          inProgressTotal: m("0"),
          inProgressCalls: 0,
          freeCalls: 0,
          failRate: null,
          deltaCalls: calls - 5,
          deltaListedTotal: m("0"),
          deltaChargedTotal: m(String(BigInt(charged) - BigInt(prevCharged))),
          deltaWithheldTotal: m("0"),
          deltaNotChargedTotal: m("0"),
          deltaOwedTotal: m("0"),
        }
      : null,
  };
}

describe("spend headline", () => {
  it("says how much the spend moved", () => {
    expect(changePercent(m("1120000"), m("1000000"))).toBe("▲ 12%");
    expect(changePercent(m("900000"), m("1000000"))).toBe("▼ 10%");
    expect(changePercent(m("1000000"), m("0"))).toBeNull();
    expect(changePercent(m("1000000"), null)).toBeNull();
  });
  it("rebuilds the previous total from the comparisons", () => {
    expect(previousTotal([group("a", "100", "100", 10, "40"), group("b", "50", "50", 3, "10")])?.amount).toBe("50");
  });
});

describe("rankRows", () => {
  it("ranks by listed spend, names each row and marks free-only rows", () => {
    const rows = rankRows([group("small", "100", "100"), group("big", "1000", "800", 10, "500"), group("free", "0", "0", 7)], (k) => k.toUpperCase());
    expect(rows.map((r) => r.label)).toEqual(["BIG", "SMALL", "FREE"]);
    expect(rows[0]!.chargedPct).toBe(80);
    expect(rows[0]!.notChargedPct).toBe(20);
    expect(rows[0]!.delta).toBe("▲ +$0.0003");
    expect(rows[1]!.delta).toBeNull();
    expect(rows[2]!.free).toBe(true);
  });
  it("marks a free-tier-only group (calls 0, freeCalls > 0) as free and counts its free calls", () => {
    const freeOnly = { ...group("free", "0", "0", 0), freeCalls: 4 };
    const [row] = rankRows([freeOnly], (k) => k);
    expect(row!.free).toBe(true);
    expect(row!.calls).toBe(0);
    expect(row!.freeCalls).toBe(4);
  });
  it("does not count a zero-price intent twice (in calls and in freeCalls)", () => {
    const [row] = rankRows([{ ...group("free", "0", "0", 2), freeCalls: 5 }], (k) => k);
    expect(row!.calls).toBe(0);
    expect(row!.freeCalls).toBe(5);
  });
  it("keeps an empty group (no calls, no free calls) not free, as before", () => {
    const [row] = rankRows([group("none", "0", "0", 0)], (k) => k);
    expect(row!.free).toBe(false);
    expect(row!.calls).toBe(0);
  });
  it("keeps a paid row's count as its paid calls, its free calls apart", () => {
    const [row] = rankRows([{ ...group("paid", "100", "100", 3), freeCalls: 9 }], (k) => k);
    expect(row!.free).toBe(false);
    expect(row!.calls).toBe(3);
    expect(row!.freeCalls).toBe(9);
  });
  it("counts calls as the headline does on every tab: paid rows add up to the paid total, free apart (BUG-PROD-BUY-SPEND-01)", () => {
    // 12 paid + 5 free: by tool, a paid tool and a free-only one; by provider, one mixed row.
    const byTool = rankRows([group("rate", "120", "120", 12), { ...group("weather", "0", "0", 0), freeCalls: 5 }], (k) => k);
    const byProvider = rankRows([{ ...group("p1", "120", "120", 12), freeCalls: 5 }], (k) => k);
    for (const rows of [byTool, byProvider]) {
      expect(rows.reduce((n, r) => n + r.calls, 0)).toBe(12);
      expect(rows.reduce((n, r) => n + r.freeCalls, 0)).toBe(5);
    }
    const csv = (groups: Parameters<typeof spendCsv>[0]) =>
      spendCsv(groups, { dimensionHeader: "Tool", labelOf: (k) => k, assetLabel: "USDG" }).split("\n").slice(1).map((line) => line.split(","));
    const tool = csv([group("rate", "120", "120", 12), { ...group("weather", "0", "0", 0), freeCalls: 5 }]);
    expect(tool.map((cells) => [cells[3], cells[10]])).toEqual([["12", "0"], ["0", "5"]]);
  });
});

describe("paidGroups", () => {
  it("leaves out a free-tier-only group (calls 0) and keeps paid ones", () => {
    const groups = [group("paid", "100", "100", 2), { ...group("free", "0", "0", 0), freeCalls: 3 }];
    expect(paidGroups(groups).map((g) => g.key)).toEqual(["paid"]);
  });
});

describe("spend CSV", () => {
  it("has names and ids, the asset, and a from_to filename", () => {
    const csv = spendCsv([group("t1", "1500", "1000")], {
      dimensionHeader: "Tool",
      labelOf: () => "search, web",
      assetLabel: "USDG on Robinhood",
    });
    expect(csv.split("\n")[0]).toBe("Tool,Tool id,Asset,Calls,Listed,Charged,Not charged,Not charged calls,Owed,Owed calls,Free calls");
    expect(csv.split("\n")[1]).toBe('"search, web",t1,USDG on Robinhood,10,0.001500,0.001000,0.000500,1,0.000000,0,0');
    expect(spendCsvFilename("tool", "2026-10-09T10:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe(
      "spend-by-tool_2026-10-09_2026-10-15.csv",
    );
  });
});

describe("spend CSV, free-only group (fe-followup M5)", () => {
  it("counts its calls as free calls, not as paid calls", () => {
    const g = { ...group("t1", "0", "0", 0), freeCalls: 4 };
    const csv = spendCsv([g], { dimensionHeader: "Tool", labelOf: (k) => k, assetLabel: "USDG" });
    expect(csv.split("\n")[1]).toBe("t1,t1,USDG,0,0.000000,0.000000,0.000000,0,0.000000,0,4");
  });
});

describe("owed (buyer debt) is its own bucket", () => {
  it("draws owed apart from not charged, and exports it", () => {
    const g = { ...group("t1", "1500", "1000"), owedTotal: m("250"), owedCalls: 1, notChargedTotal: m("250") };
    const [row] = rankRows([g], (k) => k);
    expect(row!.owed).toBe("$0.00025");
    expect(row!.owedPct).toBeGreaterThan(0);
    const csv = spendCsv([g], { dimensionHeader: "Tool", labelOf: (k) => k, assetLabel: "USDG" });
    expect(csv.split("\n")[0]).toContain("Owed,Owed calls");
    expect(csv.split("\n")[1]!.endsWith(",0.000250,1,0")).toBe(true);
  });
});
