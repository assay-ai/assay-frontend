import { describe, expect, it } from "vitest";

import type { PublicTool } from "@/services/public-explorer.service";

import { activeUsersText, badgeLabel, priceRangeText, statRows, trustFacts } from "./public";

const USDC = "eip155:1/erc20:0xusdc";
const usd = (amount: string) => ({ amount, asset: USDC, decimals: 6 });

function tool(id: string, patch: Partial<PublicTool> = {}): PublicTool {
  return {
    id,
    name: id,
    description: "",
    tier: "VERIFIED",
    providerCount: 2,
    fromPrice: usd("1000"),
    price: usd("2000"),
    pricingMode: "PAID",
    routable: true,
    settlementChains: null,
    ...patch,
  };
}

describe("public cards: prices joined from the catalogue", () => {
  it("spans the cheapest to the dearest call", () => {
    expect(priceRangeText([tool("a"), tool("b", { fromPrice: usd("5000"), price: usd("10000") })])).toBe("$0.001–$0.01 a call");
    expect(priceRangeText([tool("a", { fromPrice: usd("2000"), price: usd("2000") })])).toBe("$0.002 a call");
    expect(priceRangeText([tool("a", { pricingMode: "FREE", fromPrice: usd("0"), price: usd("0") })])).toBe("Free");
    expect(priceRangeText([tool("a", { pricingMode: "FREEMIUM" })])).toBe("Free calls, then $0.001–$0.002 a call");
    expect(priceRangeText([tool("a", { routable: false })])).toBeNull();
  });

  it("finds the trust facts: one provider, not in the catalogue, removed, self-routing", () => {
    const catalogue = [tool("t1"), tool("t2", { providerCount: 1 }), tool("t3")];
    const facts = trustFacts(
      {
        toolIds: ["t1", "t2", "t3", "maker__own"],
        routesToPublisher: true,
        entries: [
          { toolId: "t1", toolName: "search_web", providerMode: "ONLY", providerCount: 1, minTier: null, onEmpty: "FAIL", removed: false, notReviewed: false },
          { toolId: "t2", toolName: "scrape_url", providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL", removed: false, notReviewed: false },
          { toolId: "t3", toolName: "old_tool", providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL", removed: true, notReviewed: false },
          { toolId: "maker__own", toolName: "maker__own", providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL", removed: false, notReviewed: true },
        ],
      },
      catalogue,
    );
    // "Only these" with one provider leaves no backup, as does a tool only one provider serves.
    expect(facts.noBackup).toEqual(["search_web", "scrape_url"]);
    expect(facts.notReviewed).toEqual(["maker__own"]);
    expect(facts.removed).toEqual(["old_tool"]);
    expect(facts.routesToPublisher).toBe(true);
  });

  it("names the badge and the users", () => {
    expect(badgeLabel("OFFICIAL")).toBe("Official");
    expect(badgeLabel("PROVIDER")).toBe("Provider");
    expect(badgeLabel("anything")).toBe("Community");
    expect(activeUsersText({ value: 35, display: "35" })).toBe("35 users");
    expect(activeUsersText({ value: null, display: "Fewer than 5" })).toBe("Fewer than 5 users");
    expect(activeUsersText(null)).toBe("New");
  });
});

describe("weekly figures respect k = 5", () => {
  it("below 5 teams: only what the server published, withheld as it spelt it, never 0", () => {
    const rows = statRows({
      activeUsers: { value: null, display: "Fewer than 5" },
      agents: null,
      calls30d: null,
      copies: { value: null, display: "Fewer than 5" },
      trend: null,
      onLatestVersionPercent: null,
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Active users (30 days)", "Fewer than 5"],
      ["Own versions made", "Fewer than 5"],
    ]);
    expect(rows[0]!.note).toMatch(/at least 5 teams/);
    expect(rows.some((r) => r.value === "0")).toBe(false);
  });

  it("above 5 teams: every figure, the trend as an arrow, the share on the latest version", () => {
    const rows = statRows({
      activeUsers: { value: 35, display: "35" },
      agents: { value: 60, display: "60" },
      calls30d: { value: 12000, display: "12k" },
      copies: { value: 10, display: "10" },
      trend: "UP",
      onLatestVersionPercent: 70,
    });
    expect(rows.map((r) => r.value)).toEqual(["35", "60", "12k", "10", "↑ Growing", "70%"]);
    expect(rows[0]!.note).toBeUndefined();
  });

  it("no figures yet: nothing to show", () => {
    expect(statRows(null)).toEqual([]);
    expect(statRows({ activeUsers: null, agents: null, calls30d: null, copies: null, trend: null, onLatestVersionPercent: null })).toEqual([]);
  });
});
