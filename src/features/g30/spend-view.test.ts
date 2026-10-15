import { describe, expect, it } from "vitest";

import { changePercent, previousTotal, rankRows, spendCsv, spendCsvFilename } from "./spend-view";
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
    failRate: null,
    comparison: prevCharged
      ? {
          calls: 5,
          refundedCalls: 0,
          listedTotal: m(prevCharged),
          chargedTotal: m(prevCharged),
          withheldTotal: m("0"),
          failRate: null,
          deltaCalls: calls - 5,
          deltaListedTotal: m("0"),
          deltaChargedTotal: m(String(BigInt(charged) - BigInt(prevCharged))),
          deltaWithheldTotal: m("0"),
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
});

describe("spend CSV", () => {
  it("has names and ids, the asset, and a from_to filename", () => {
    const csv = spendCsv([group("t1", "1500", "1000")], {
      dimensionHeader: "Tool",
      labelOf: () => "search, web",
      assetLabel: "USDG on Robinhood",
    });
    expect(csv.split("\n")[0]).toBe("Tool,Tool id,Asset,Calls,Listed,Charged,Not charged,Not charged calls");
    expect(csv.split("\n")[1]).toBe('"search, web",t1,USDG on Robinhood,10,0.001500,0.001000,0.000500,1');
    expect(spendCsvFilename("tool", "2026-10-09T10:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe(
      "spend-by-tool_2026-10-09_2026-10-15.csv",
    );
  });
});
