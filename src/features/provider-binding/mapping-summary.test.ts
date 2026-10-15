import { describe, expect, it } from "vitest";

import { listJoin, requestMappingSummary, responseMappingSummary } from "./mapping-summary";

describe("requestMappingSummary", () => {
  it("names the fields and where they go, without mapping jargon", () => {
    expect(
      requestMappingSummary({ method: "GET", path: "/", query: { city: { $path: "$.city" }, units: { $path: "$.units?", $optional: true } } }),
    ).toBe("We send city and units as query parameters to your API.");
  });

  it("counts fixed values and reads shorthand and path templates", () => {
    expect(
      requestMappingSummary({
        method: "GET",
        path: "/v1/vessels/{mmsi}",
        query: { limit: { $const: "25" } },
        headers: { accept: "application/json", "x-key": "$.key" },
      }),
    ).toBe("We send key as a header and mmsi in the address to your API. We also add 2 fixed values.");
  });

  it("handles a mapping with no agent input", () => {
    expect(requestMappingSummary({ method: "GET", path: "/" })).toBe("We call your API with no input from the agent.");
  });
});

describe("responseMappingSummary", () => {
  it("lists the result fields", () => {
    expect(responseMappingSummary({ temperature: { $path: "$.t" }, conditions: { $path: "$.c" }, observedAt: { $path: "$.ts" } })).toBe(
      "We read temperature, conditions and observedAt from your API's answer.",
    );
  });
});

describe("listJoin", () => {
  it("joins like a sentence", () => {
    expect(listJoin(["a", "b", "c"])).toBe("a, b and c");
  });
});
