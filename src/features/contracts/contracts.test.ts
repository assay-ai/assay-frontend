import { describe, expect, it } from "vitest";

import type { ContractShape } from "./diff";
import { contractProblems, diffContracts } from "./diff";
import { bumpSemver, compareSemverText, formatVersionRange, majorsText, parseVersionRange, rangeText } from "./semver";
import {
  bumpEffect,
  bumpTitle,
  changeText,
  deprecatedBadge,
  deprecationSentence,
  mustReturnLabel,
  newerVersion,
  problemText,
  publishLabel,
  retiredBadge,
  sunsetDay,
  sunsetDayFrom,
  sunsetProblem,
} from "./text";

const base: ContractShape = {
  summary: "Current temperature.",
  description: "Temperature now.",
  inputSchema: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } }, required: ["latitude", "longitude"] },
  outputSchema: { type: "object", properties: { temperature: { type: "number" } }, required: ["temperature"] },
  optionalInputFields: [],
  optionalOutputFields: [],
  examples: [],
};

describe("versions and ranges", () => {
  it("bumps a version by its change", () => {
    expect(bumpSemver("1.1.0", "PATCH")).toBe("1.1.1");
    expect(bumpSemver("1.1.3", "MINOR")).toBe("1.2.0");
    expect(bumpSemver("1.4.2", "MAJOR")).toBe("2.0.0");
    expect(bumpSemver(null, "MAJOR")).toBe("1.0.0");
    expect(compareSemverText("2.0.0", "1.10.0")).toBeGreaterThan(0);
  });

  it("reads and writes ranges of majors only", () => {
    expect(parseVersionRange("^2||^1")).toEqual([1, 2]);
    expect(parseVersionRange("^1.2")).toBeNull();
    expect(parseVersionRange("^0")).toBeNull();
    expect(formatVersionRange([2, 1, 2])).toBe("^1 || ^2");
    expect(majorsText([3, 1, 2])).toBe("v1, v2 and v3");
    expect(rangeText("^1 || ^2")).toBe("v1 and v2");
  });
});

describe("the schema diff (a mirror of the backend's)", () => {
  it("calls wording a patch", () => {
    const diff = diffContracts(base, { ...base, summary: "The temperature now." });
    expect(diff.bump).toBe("PATCH");
    expect(changeText(diff.changes[0]!)).toBe("Summary changed");
  });

  it("calls a new optional output a minor", () => {
    const after = {
      ...base,
      outputSchema: { ...base.outputSchema, properties: { ...base.outputSchema.properties, uv_index: { type: "number" } } },
      optionalOutputFields: ["uv_index"],
    };
    const diff = diffContracts(base, after);
    expect(diff.bump).toBe("MINOR");
    expect(diff.changes.map(changeText)).toEqual(["New optional output field: uv_index"]);
  });

  it("calls a rename breaking: one field removed, one added", () => {
    const after = { ...base, outputSchema: { type: "object", properties: { temperature_c: { type: "number" } }, required: ["temperature_c"] } };
    const diff = diffContracts(base, after);
    expect(diff.bump).toBe("MAJOR");
    expect(diff.changes.map(changeText)).toEqual([
      "Output field removed: temperature",
      "New output field every provider must return: temperature_c",
    ]);
  });

  it("calls promoting an optional field breaking", () => {
    const before = { ...base, optionalInputFields: ["units"], inputSchema: { ...base.inputSchema, properties: { ...base.inputSchema.properties, units: { type: "string" } } } };
    const diff = diffContracts(before, { ...before, optionalInputFields: [] });
    expect(diff.bump).toBe("MAJOR");
    expect(changeText(diff.changes[0]!)).toBe("Input field units is no longer optional: every provider must accept it");
  });

  it("ignores annotations when it compares types", () => {
    const after = { ...base, outputSchema: { ...base.outputSchema, properties: { temperature: { type: "number", description: "°C" } } } };
    expect(diffContracts(base, after).bump).toBe("PATCH");
  });

  it("finds nothing when nothing changed", () => {
    expect(diffContracts(base, { ...base })).toEqual({ bump: null, changes: [] });
  });
});

describe("contract problems", () => {
  it("wants every output required or optional, and says so in plain words", () => {
    const shape = { ...base, outputSchema: { type: "object", properties: { temperature: { type: "number" }, note: { type: "string" } }, required: ["temperature"] } };
    const problems = contractProblems(shape);
    expect(problems).toHaveLength(1);
    expect(problemText(problems[0]!)).toBe('Output "note" is neither required nor an extra field. Keep it as an extra field, or make it required.');
  });

  it("caps the summary at 200 characters on one line", () => {
    const problems = contractProblems({ ...base, summary: `${"a".repeat(201)}\nb` }).map(problemText);
    expect(problems).toContain("Shorten the summary to 200 characters or fewer.");
    expect(problems).toContain("Keep the summary on one line.");
  });

  it("rewords server refusals of the editor", () => {
    expect(problemText("identical to v1.1.0")).toBe("Nothing changed from v1.1.0 yet. Edit something before publishing.");
    expect(problemText("v2 is the current major; move the current version first")).toBe(
      "v2 is the version agents get by default. Make another version the default first.",
    );
    expect(problemText("a publish of this draft awaits a second operator (approval apr-1); reject it to edit")).toContain("waiting for approval");
    expect(problemText("something odd happened")).toBe("Something odd happened.");
  });
});

describe("bumps in words", () => {
  it("names the bump and the number on the title and the confirm button", () => {
    expect(bumpTitle("MAJOR", "2.0.0")).toBe("Breaking change → v2.0.0");
    expect(bumpTitle(null, "1.1.0")).toBe("No changes yet");
    expect(publishLabel("MINOR", "2.1.0")).toBe("Publish new optional field v2.1.0");
    expect(publishLabel("MAJOR", "3.0.0")).toBe("Publish breaking change v3.0.0");
    expect(publishLabel("MAJOR", "1.0.0", { firstVersion: true })).toBe("Publish first version v1.0.0");
  });

  it("says who must do what after each bump", () => {
    expect(bumpEffect("PATCH", "1.0.1")).toMatch(/don't need to do anything/);
    expect(bumpEffect("MAJOR", "3.0.0")).toMatch(/re-map and pass a new test for v3.*keep using v2 until you make v3 the default/);
  });
});

describe("deprecation in words (UTC)", () => {
  const sunset = "2027-02-01T00:00:00.000Z";

  it("prints the sunset day with its year, in UTC", () => {
    expect(sunsetDay(sunset)).toBe("Feb 1, 2027");
    expect(deprecatedBadge(sunset)).toBe("Deprecated · stops on Feb 1, 2027 (UTC)");
    expect(retiredBadge("v2.0.0")).toBe("Retired · use v2.0.0");
    expect(deprecationSentence(1, { sunsetAt: sunset, replacement: "v2.0.0" })).toBe("Version 1 stops working on Feb 1, 2027 (UTC). Use v2.0.0 instead.");
  });

  it("finds the newer version that replaces a major", () => {
    const versions = [
      { semver: "2.0.0", major: 2, status: "ACTIVE" as const },
      { semver: "1.1.0", major: 1, status: "DEPRECATED" as const },
    ];
    expect(newerVersion(versions, 1)).toBe("v2.0.0");
    expect(newerVersion(versions, 2)).toBeNull();
  });

  it("allows a sunset from the server's earliest sunset on, at midnight UTC", () => {
    const earliest = "2027-01-15T15:30:00.000Z";
    expect(sunsetProblem("2027-01-16", earliest)).toBeNull();
    expect(sunsetProblem("2027-01-14", earliest)).toMatch(/Pick Jan 16, 2027 or later/);
    expect(sunsetProblem("", earliest)).toBe("Pick a date.");
  });

  it("starts the date picker at the first whole UTC day of the server's earliest sunset", () => {
    expect(sunsetDayFrom("2027-01-16T00:00:00.000Z")).toBe("2027-01-16");
    expect(sunsetDayFrom("2027-01-16T15:30:00.000Z")).toBe("2027-01-17");
    expect(sunsetDayFrom("2026-12-31T23:59:59.999Z")).toBe("2027-01-01");
  });

  it("labels Must return as the spec does", () => {
    expect(mustReturnLabel(["uv_index"])).toBe("Must return: uv_index");
  });
});
