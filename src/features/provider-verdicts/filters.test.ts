import { describe, expect, it } from "vitest";

import { fromDayToIso, toDayToIso, validateVerdictFilters } from "./filters";

const EMPTY = { agentId: "", reasonCode: "", from: "", to: "" };

describe("verdict filter days", () => {
  it("reads From and To as the start and end of a UTC day", () => {
    expect(fromDayToIso("2026-10-10")).toBe("2026-10-10T00:00:00.000Z");
    expect(toDayToIso("2026-10-10")).toBe("2026-10-10T23:59:59.999Z");
    expect(fromDayToIso("")).toBeUndefined();
    expect(toDayToIso("")).toBeUndefined();
  });
});

describe("validateVerdictFilters", () => {
  it("accepts empty filters and a valid range", () => {
    expect(validateVerdictFilters(EMPTY)).toBeNull();
    expect(validateVerdictFilters({ ...EMPTY, from: "2026-10-09", to: "2026-10-09" })).toBeNull();
  });

  it("rejects From after To", () => {
    expect(validateVerdictFilters({ ...EMPTY, from: "2026-10-10", to: "2026-10-09" })).toMatch(
      /From must be/,
    );
  });

  it("rejects an agent id that is not a UUID", () => {
    expect(validateVerdictFilters({ ...EMPTY, agentId: "notauuid" })).toMatch(/UUID/);
    expect(
      validateVerdictFilters({ ...EMPTY, agentId: "0b0e6d1a-4c1f-4f6e-9d3a-2f6f5a1c7b10" }),
    ).toBeNull();
  });
});
