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
});
