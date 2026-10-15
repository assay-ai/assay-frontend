import { describe, expect, it } from "vitest";

import { searchSuggestions } from "./buyer-search";

const tools = new Map([
  ["tool-1", "deep_research"],
  ["tool-2", "geocode_place"],
  ["tool-3", "search_web"],
]);
const calls = [
  { intentId: "248e4a07-40d4-4f20-b5e8-53c58e95f51a", toolId: "tool-2", createdAt: "2026-10-13T17:55:23Z" },
  { intentId: "9bde76e8-0d02-4ca8-9978-d32d2d4f434f", toolId: "tool-1", createdAt: "2026-10-13T17:21:13Z" },
];

describe("searchSuggestions", () => {
  it("lists tools by part of their name, prefix matches first", () => {
    const rows = searchSuggestions("geocode", tools);
    expect(rows.map((r) => r.label)).toEqual(["geocode_place"]);
    expect(rows[0]?.href).toBe("/spend/calls?tool=tool-2");
    expect(searchSuggestions("search", tools)[0]?.label).toBe("search_web");
    expect(searchSuggestions("e", tools).map((r) => r.label)).toEqual(["deep_research", "geocode_place", "search_web"]);
  });

  it("lists recent calls by the start of their id, each opening its receipt", () => {
    const rows = searchSuggestions("248e", tools, calls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "call", href: "/receipts/view?id=248e4a07-40d4-4f20-b5e8-53c58e95f51a" });
    expect(rows[0]?.hint).toMatch(/^geocode_place · /);
  });

  it("offers a full call id even when it is not recent, and nothing for an empty query", () => {
    const id = "01JABCDEFGHJKMNPQRSTVWXYZ0";
    expect(searchSuggestions(id, tools)[0]?.href).toBe(`/receipts/view?id=${id}`);
    expect(searchSuggestions("  ", tools)).toEqual([]);
    expect(searchSuggestions("nothing like it", tools)).toEqual([]);
  });
});
