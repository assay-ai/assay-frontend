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
    paidBindings: 2,
    freeCallsPerDay: null,
    summary: "",
    version: null,
    versions: [],
    deprecatedMajors: [],
    replacementToolId: null,
    replacementName: null,
    replacementMajor: null,
    replacementVersion: null,
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

  describe("backup provider facts (BUG-PUB-01)", () => {
    const entry = (toolId: string, providerCount: number, extra: Record<string, unknown> = {}) => ({
      toolId,
      toolName: toolId,
      providerMode: "BEST" as const,
      providerCount,
      minTier: null,
      onEmpty: "FAIL" as const,
      removed: false,
      notReviewed: false,
      ...extra,
    });

    it("tools nobody serves are unserved, never backed up", () => {
      const f = trustFacts({ toolIds: ["a", "b"], entries: [entry("a", 0), entry("b", 0)] }, []);
      expect(f.unserved).toEqual(["a", "b"]);
      expect(f.noBackup).toEqual([]);
      expect(f.allBackedUp).toBe(false);
    });

    it("a card without entries: missing from a loaded catalogue means unserved; pending means unknown", () => {
      expect(trustFacts({ toolIds: ["a"] }, [tool("t1")]).unserved).toEqual(["a"]);
      const pending = trustFacts({ toolIds: ["a"] }, null);
      expect(pending.unserved).toEqual([]);
      expect(pending.noBackup).toEqual([]);
      expect(pending.allBackedUp).toBe(false);
    });

    it("one provider is no backup", () => {
      const f = trustFacts({ toolIds: ["t1"], entries: [entry("t1", 1)] }, [tool("t1", { providerCount: 1 })]);
      expect(f.noBackup).toEqual(["t1"]);
      expect(f.allBackedUp).toBe(false);
    });

    it("a catalogue tool with providerCount 0 is unserved", () => {
      expect(trustFacts({ toolIds: ["t1"] }, [tool("t1", { providerCount: 0 })]).unserved).toEqual(["t1"]);
    });

    it("a mix of 0 and 2 warns and does not claim a backup", () => {
      const f = trustFacts({ toolIds: ["t1", "t2"], entries: [entry("t1", 2), entry("t2", 0)] }, [tool("t1", { providerCount: 2 })]);
      expect(f.unserved).toEqual(["t2"]);
      expect(f.allBackedUp).toBe(false);
    });

    it("a removed entry is left out of both lists and blocks the claim", () => {
      const f = trustFacts({ toolIds: ["t1", "t2"], entries: [entry("t1", 2), entry("t2", 0, { removed: true })] }, [tool("t1", { providerCount: 2 })]);
      expect(f.unserved).toEqual([]);
      expect(f.noBackup).toEqual([]);
      expect(f.allBackedUp).toBe(false);
    });

    it("ONLY narrows three providers to one", () => {
      const f = trustFacts({ toolIds: ["t1"], entries: [entry("t1", 1, { providerMode: "ONLY" })] }, [tool("t1", { providerCount: 3 })]);
      expect(f.noBackup).toEqual(["t1"]);
    });

    it("two or more providers for every tool is a backup", () => {
      const f = trustFacts({ toolIds: ["t1"], entries: [entry("t1", 2)] }, [tool("t1", { providerCount: 2 })]);
      expect(f.noBackup).toEqual([]);
      expect(f.unserved).toEqual([]);
      expect(f.allBackedUp).toBe(true);
    });

    it("a maker's own tool in the catalogue with one provider still warns", () => {
      const f = trustFacts({ toolIds: ["t1"], entries: [entry("t1", 1, { notReviewed: true })] }, [tool("t1", { providerCount: 1 })]);
      expect(f.noBackup).toEqual(["t1"]);
    });
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
