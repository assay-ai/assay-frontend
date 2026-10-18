import { describe, expect, it } from "vitest";

import { schemaFields } from "../mapping-editor";

import { argumentsFromText, exampleOf, needsLine, returnsLine, seedArguments, seedRequestMapping } from "./seeds";

const inputSchema = {
  type: "object",
  required: ["symbol"],
  properties: {
    symbol: { type: "string", examples: ["ETH-USD"] },
    limit: { type: "integer", default: 25 },
    live: { type: "boolean" },
  },
};

describe("wizard seeds", () => {
  it("prefills test arguments from the schema's examples", () => {
    expect(seedArguments(inputSchema)).toEqual({ symbol: "ETH-USD", limit: "25", live: "" });
    expect(exampleOf(inputSchema, "missing")).toBe("");
  });

  it("prefills from the contract's own worked example first (T3)", () => {
    const examples = [{ title: "x", arguments: { symbol: "BTC-USD", limit: 5 } }];
    expect(seedArguments(inputSchema, examples)).toEqual({ symbol: "BTC-USD", limit: "5", live: "" });
  });

  it("types arguments by the schema and skips empty boxes", () => {
    const fields = schemaFields(inputSchema);
    expect(argumentsFromText(fields, { symbol: "BTC", limit: "5", live: "" })).toEqual({
      input: { symbol: "BTC", limit: 5 },
      error: null,
    });
    expect(argumentsFromText(fields, { limit: "1.5" }).error).toMatch(/whole number/);
    expect(argumentsFromText(fields, { live: "yes" }).error).toMatch(/true or false/);
  });

  it("forwards every argument by name", () => {
    const tool = { id: "t", name: "T", description: "", tier: "VERIFIED" as const, inputSchema, outputSchema: {} };
    expect(seedRequestMapping(tool)).toEqual({
      method: "GET",
      path: "/",
      query: { symbol: { $path: "$.symbol" }, limit: { $path: "$.limit" }, live: { $path: "$.live" } },
    });
  });

  it("says what a tool returns and needs in words", () => {
    expect(returnsLine({ outputSchema: { properties: { temperature: {}, observedAt: {} } } })).toBe(
      "Returns: temperature, observed at",
    );
    expect(needsLine({ inputSchema })).toBe("Needs: symbol");
    expect(returnsLine({ outputSchema: {} })).toBeNull();
  });
});
