import { describe, expect, it } from "vitest";

import { searchTarget } from "./buyer-search";

const tools = new Map([
  ["tool-1", "deep_search"],
  ["tool-2", "price_quote"],
]);

describe("searchTarget", () => {
  it("opens a receipt for a call id", () => {
    expect(searchTarget("01JABCDEFGHJKMNPQRSTVWXYZ0", tools)).toBe("/receipts/view?id=01JABCDEFGHJKMNPQRSTVWXYZ0");
  });

  it("filters Calls by a tool named exactly or in part", () => {
    expect(searchTarget("Price_Quote", tools)).toBe("/spend/calls?tool=tool-2");
    expect(searchTarget("search", tools)).toBe("/spend/calls?tool=tool-1");
  });

  it("falls back to all calls", () => {
    expect(searchTarget("nothing like it", tools)).toBe("/spend/calls");
    expect(searchTarget("  ", tools)).toBe("/spend/calls");
  });
});
