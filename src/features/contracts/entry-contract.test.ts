import { describe, expect, it } from "vitest";

import { ruleChangeText } from "@/features/toolsets/sharing";
import type { ToolContractVersion, ToolVersionBrief } from "@/interfaces/contracts";

import {
  contractChipParts,
  currentMajorOf,
  entryContractWarning,
  entryMajors,
  majorChoiceLabel,
  majorChoices,
  majorsChipText,
  mustReturnEffect,
  optionalOutputsFor,
  unknownRequiredFields,
} from "./entry-contract";

const SUNSET = "2027-02-01T00:00:00.000Z";

function brief(version: number, semver: string, status: ToolVersionBrief["status"], isCurrent = false): ToolVersionBrief {
  return { version, semver, major: Number(semver.split(".")[0]), status, sunsetAt: status === "ACTIVE" ? null : SUNSET, changelog: null, publishedAt: null, isCurrent };
}

const WEATHER = [brief(3, "2.0.0", "ACTIVE", true), brief(2, "1.1.0", "DEPRECATED"), brief(1, "1.0.0", "DEPRECATED")];

function full(b: ToolVersionBrief, outputs: string[]): ToolContractVersion {
  return {
    ...b,
    summary: "",
    description: "",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    optionalInputFields: [],
    optionalOutputFields: outputs,
    examples: [],
    tier: "VERIFIED",
  };
}

describe("a tool set entry's contract terms", () => {
  it("one choice per major, newest first, with its newest version and status", () => {
    const choices = majorChoices(WEATHER);
    expect(choices.map((c) => [c.major, c.latestSemver, c.status, c.isCurrent])).toEqual([
      [2, "2.0.0", "ACTIVE", true],
      [1, "1.1.0", "DEPRECATED", false],
    ]);
    expect(currentMajorOf(WEATHER)).toBe(2);
  });

  it("labels each major in plain words, the sunset in UTC with its year", () => {
    const [v2, v1] = majorChoices(WEATHER);
    expect(majorChoiceLabel(v2!)).toBe("v2 (latest 2.0.0) · current");
    expect(majorChoiceLabel(v1!)).toBe("v1 (latest 1.1.0) · stops on Feb 1, 2027 (UTC)");
    expect(majorChoiceLabel({ ...v1!, status: "RETIRED" })).toBe("v1 (latest 1.1.0) · retired, no longer works");
  });

  it("an entry with no range follows the current major", () => {
    expect(entryMajors(null, WEATHER)).toEqual([2]);
    expect(entryMajors("^1 || ^2", WEATHER)).toEqual([1, 2]);
  });

  it("the chip: Must return, and the version only when it is not just the current one", () => {
    expect(contractChipParts({ toolVersionRange: "^2", requireOutputFields: [] }, 2)).toEqual([]);
    expect(contractChipParts({ toolVersionRange: "^1", requireOutputFields: ["uv_index"] }, 2)).toEqual(["Must return: uv_index", "v1 only"]);
    expect(contractChipParts({ toolVersionRange: "^1 || ^2" }, 2)).toEqual(["v1 or v2"]);
    expect(majorsChipText([3, 1, 2])).toBe("v1, v2 or v3");
  });

  it("extra outputs come from the newest version of each major in range", () => {
    const versions = [full(WEATHER[0]!, ["uv_index", "humidity"]), full(WEATHER[1]!, ["uv_index"]), full(WEATHER[2]!, [])];
    expect(optionalOutputsFor(versions, [1])).toEqual(["uv_index"]);
    expect(optionalOutputsFor(versions, [1, 2])).toEqual(["uv_index", "humidity"]);
    expect(unknownRequiredFields(["humidity"], optionalOutputsFor(versions, [1]))).toEqual(["humidity"]);
  });

  it("warns when every version in range is deprecated, with the one-click Allow v2", () => {
    expect(entryContractWarning("^2", WEATHER)).toBeNull();
    expect(entryContractWarning("^1 || ^2", WEATHER)).toBeNull();
    expect(entryContractWarning("^1", WEATHER)).toEqual({
      tone: "warning",
      text: "Uses v1, which stops working on Feb 1, 2027 (UTC).",
      fix: { label: "Allow v2", range: "^1 || ^2" },
    });
  });

  it("a retired range is refused now: danger, and the same fix", () => {
    const retired = WEATHER.map((v) => (v.major === 1 ? { ...v, status: "RETIRED" as const } : v));
    expect(entryContractWarning("^1", retired)).toEqual({
      tone: "danger",
      text: "Uses v1, which was retired: calls to this tool are refused.",
      fix: { label: "Allow v2", range: "^1 || ^2" },
    });
  });

  it("says what Must return does", () => {
    expect(mustReturnEffect([])).toBe("Any provider's answer is fine.");
    expect(mustReturnEffect(["uv_index"])).toBe("Only providers that return uv_index serve these calls, so fewer may fit.");
  });
});

describe("rule changes in words (versions and updates)", () => {
  const base = { providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL" };
  it("names Must return and contract version changes", () => {
    expect(ruleChangeText({ ...base, requireOutputFields: [] }, { ...base, requireOutputFields: ["uv_index"] })).toBe("Must return: nothing extra → uv_index");
    expect(ruleChangeText({ ...base, toolVersionRange: "^1" }, { ...base, toolVersionRange: "^1 || ^2" })).toBe("Contract version: v1 → v1 and v2");
  });
  it("an older version without the fields reads the same as none", () => {
    expect(ruleChangeText({ ...base }, { ...base, requireOutputFields: [], toolVersionRange: null })).toBeNull();
  });
});
