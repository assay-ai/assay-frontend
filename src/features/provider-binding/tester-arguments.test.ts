import { describe, expect, it } from "vitest";

import { argumentsProblem } from "./tester-arguments";

// The seeded catalogue's get_weather and search_wikipedia schemas.
const weather = {
  type: "object",
  required: ["latitude", "longitude"],
  properties: { latitude: { type: "number" }, longitude: { type: "number" } },
};
const wikipedia = {
  type: "object",
  required: ["query"],
  properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } },
};

describe("argumentsProblem", () => {
  it("names the required fields the seeded skeleton leaves null", () => {
    expect(argumentsProblem({ latitude: null, longitude: null }, weather)).toBe(
      "Enter latitude and longitude before running: the tool requires them."
    );
  });

  it("names a required field that is absent", () => {
    expect(argumentsProblem({ latitude: 52.52 }, weather)).toBe(
      "Enter longitude before running: the tool requires it."
    );
  });

  it("lets filled arguments run", () => {
    expect(argumentsProblem({ latitude: 52.52, longitude: 13.41 }, weather)).toBeNull();
  });

  it("refuses a null optional field, and lets it be removed instead", () => {
    expect(argumentsProblem({ query: "x402", limit: null }, wikipedia)).toBe(
      "limit cannot be null: enter a value or remove it."
    );
    expect(argumentsProblem({ query: "x402" }, wikipedia)).toBeNull();
  });

  it("lets a null through where the schema allows one", () => {
    const schema = {
      properties: { a: { type: ["string", "null"] }, b: { type: "string", nullable: true } },
    };
    expect(argumentsProblem({ a: null, b: null }, schema)).toBeNull();
  });

  it("still catches nulls when the schema did not load", () => {
    expect(argumentsProblem({ latitude: null, longitude: 1, name: null }, undefined)).toBe(
      "latitude and name cannot be null: enter a value or remove them."
    );
    expect(argumentsProblem({}, undefined)).toBeNull();
  });

  it("lists three or more fields with commas", () => {
    expect(argumentsProblem({ a: null, b: null, c: null }, undefined)).toBe(
      "a, b and c cannot be null: enter a value or remove them."
    );
  });

  // BUG-PRV-CATALOG-07: count 99 against maximum 10 went to the real upstream.
  describe("schema bounds, checked before any request", () => {
    const geocode = {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 2, maxLength: 20 },
        count: { type: "integer", minimum: 1, maximum: 10 },
        ratio: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
        old: { type: "number", minimum: 0, exclusiveMinimum: true },
        unit: { type: "string", enum: ["metric", "imperial"] },
      },
    };

    it("refuses a number outside minimum/maximum", () => {
      expect(argumentsProblem({ name: "Berlin", count: 99 }, geocode)).toBe("“count” must be at most 10.");
      expect(argumentsProblem({ name: "Berlin", count: 0 }, geocode)).toBe("“count” must be at least 1.");
    });

    it("refuses a number on an exclusive bound, in both draft styles", () => {
      expect(argumentsProblem({ name: "Berlin", ratio: 1 }, geocode)).toBe("“ratio” must be less than 1.");
      expect(argumentsProblem({ name: "Berlin", ratio: 0 }, geocode)).toBe("“ratio” must be more than 0.");
      expect(argumentsProblem({ name: "Berlin", old: 0 }, geocode)).toBe("“old” must be more than 0.");
    });

    it("refuses a string outside minLength/maxLength and a value not in enum", () => {
      expect(argumentsProblem({ name: "B" }, geocode)).toBe("“name” must be at least 2 characters.");
      expect(argumentsProblem({ name: "x".repeat(21) }, geocode)).toBe("“name” must be at most 20 characters.");
      expect(argumentsProblem({ name: "Berlin", unit: "kelvin" }, geocode)).toBe("“unit” must be one of metric, imperial.");
    });

    // Review M4: enum by value, not by key order, and text matching a number option where the field has no type.
    it("compares enum values by value", () => {
      const schema = {
        properties: {
          box: { type: "object", enum: [{ a: 1, b: [1, 2] }] },
          size: { enum: [10, 20] },
          flag: { enum: [true] },
        },
      };
      expect(argumentsProblem({ box: { b: [1, 2], a: 1 } }, schema)).toBeNull();
      expect(argumentsProblem({ box: { a: 1, b: [2, 1] } }, schema)).toBe("“box” is not one of the values the tool takes.");
      expect(argumentsProblem({ size: "10", flag: "true" }, schema)).toBeNull();
      expect(argumentsProblem({ size: 10 }, schema)).toBeNull();
      expect(argumentsProblem({ size: "30" }, schema)).toBe("“size” must be one of 10, 20.");
    });

    it("still runs values on and inside the bounds", () => {
      expect(argumentsProblem({ name: "Berlin", count: 10, ratio: 0.5, old: 3, unit: "metric" }, geocode)).toBeNull();
      expect(argumentsProblem({ name: "Be", count: 1 }, geocode)).toBeNull();
      expect(argumentsProblem({ query: "x402", limit: 10 }, wikipedia)).toBeNull();
    });
  });
});
