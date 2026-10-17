import { describe, expect, it } from "vitest";

import type { ToolContractVersion } from "@/interfaces/contracts";
import type { CatalogueTool, PublishCheck } from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";

import {
  contractMismatchProblems,
  defaultTerms,
  gateRows,
  majorChoices,
  majorNote,
  majorTestRows,
  majorTestText,
  mismatchProblemText,
  moveNotice,
  offeredFields,
  runLabel,
  sameTerms,
  servedSummary,
  splitMajorDetail,
  termsBody,
  termsOf,
  termsProblem,
  testTargets,
  toggleField,
  toggleMajor,
} from "./contract-terms";

const SUNSET = "2027-02-01T00:00:00.000Z";

function version(over: Partial<ToolContractVersion>): ToolContractVersion {
  return {
    version: 1,
    semver: "1.0.0",
    major: 1,
    status: "ACTIVE",
    summary: "s",
    description: "d",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    optionalInputFields: [],
    optionalOutputFields: [],
    examples: [],
    tier: "VERIFIED",
    sunsetAt: null,
    changelog: null,
    publishedAt: null,
    isCurrent: false,
    ...over,
  };
}

/** get_weather as the demo tells it: 1.0.0 and 1.1.0 deprecated, 2.0.0 current. */
const WEATHER: Pick<CatalogueTool, "versions" | "currentVersion"> = {
  currentVersion: "2.0.0",
  versions: [
    version({ version: 3, semver: "2.0.0", major: 2, isCurrent: true, optionalOutputFields: ["uv_index", "humidity"], optionalInputFields: ["units"] }),
    version({ version: 2, semver: "1.1.0", major: 1, status: "DEPRECATED", sunsetAt: SUNSET, optionalOutputFields: ["uv_index"], optionalInputFields: ["units"] }),
    version({ version: 1, semver: "1.0.0", major: 1, status: "DEPRECATED", sunsetAt: SUNSET }),
  ],
};

describe("contract versions you serve", () => {
  const choices = majorChoices(WEATHER);

  it("offers one choice per major, newest major first, at its newest version", () => {
    expect(choices.map((c) => [c.major, c.semver, c.version, c.current])).toEqual([
      [2, "2.0.0", 3, true],
      [1, "1.1.0", 2, false],
    ]);
  });

  it("starts a new listing on the current major with no extra fields", () => {
    expect(defaultTerms(WEATHER)).toEqual({ majors: [2], provides: [], supports: [] });
  });

  it("reads a stored listing, and a listing from before versions as v1", () => {
    expect(termsOf({ toolVersionRange: "^1 || ^2", providesOutputFields: ["uv_index"], supportsInputFields: [] })).toEqual({
      majors: [1, 2],
      provides: ["uv_index"],
      supports: [],
    });
    expect(termsOf({})).toEqual({ majors: [1], provides: [], supports: [] });
  });

  it("labels a deprecated major with its UTC sunset day and the current one as the default", () => {
    expect(majorNote(choices[1]!)).toBe("Stops on Feb 1, 2027 (UTC)");
    expect(majorNote(choices[0]!)).toBe("Current: what agents get by default");
    expect(majorNote({ ...choices[1]!, status: "RETIRED" })).toBe("Retired: no longer serves calls");
  });

  it("offers the optional fields of the majors ticked, and drops a field when its major is unticked", () => {
    expect(offeredFields(choices, [1])).toEqual({ outputs: ["uv_index"], inputs: ["units"] });
    expect(offeredFields(choices, [1, 2]).outputs).toEqual(["humidity", "uv_index"]);
    const both = { majors: [1, 2], provides: ["humidity", "uv_index"], supports: ["units"] };
    expect(toggleMajor(both, choices, 2)).toEqual({ majors: [1], provides: ["uv_index"], supports: ["units"] });
    expect(toggleMajor({ majors: [1], provides: [], supports: [] }, choices, 2).majors).toEqual([1, 2]);
    expect(toggleField(both, "provides", "humidity").provides).toEqual(["uv_index"]);
  });

  it("writes the range the API takes, majors only", () => {
    expect(termsBody({ majors: [1, 2], provides: ["uv_index"], supports: [] })).toEqual({
      toolVersionRange: "^1 || ^2",
      providesOutputFields: ["uv_index"],
      supportsInputFields: [],
    });
  });

  it("compares terms regardless of field order", () => {
    expect(sameTerms({ majors: [1], provides: ["a", "b"], supports: [] }, { majors: [1], provides: ["b", "a"], supports: [] })).toBe(true);
    expect(sameTerms({ majors: [1], provides: [], supports: [] }, { majors: [1, 2], provides: [], supports: [] })).toBe(false);
  });

  it("refuses no version, and a retired one", () => {
    expect(termsProblem({ majors: [], provides: [], supports: [] }, choices)).toBe("Pick at least one version to serve.");
    const retired = choices.map((c) => (c.major === 1 ? { ...c, status: "RETIRED" as const } : c));
    expect(termsProblem({ majors: [1], provides: [], supports: [] }, retired)).toBe("v1 no longer serves calls. Untick it.");
    expect(termsProblem({ majors: [2], provides: [], supports: [] }, choices)).toBeNull();
  });

  it("says when to move, with the date and the version to add", () => {
    expect(moveNotice({ majors: [1], provides: [], supports: [] }, choices)).toBe(
      "v1 stops on Feb 1, 2027 (UTC). Add v2, check the mapping and run a test to keep serving calls.",
    );
    expect(moveNotice({ majors: [1, 2], provides: [], supports: [] }, choices)).toBeNull();
    const retired = choices.map((c) => (c.major === 1 ? { ...c, status: "RETIRED" as const } : c));
    expect(moveNotice({ majors: [1], provides: [], supports: [] }, retired)).toBe(
      "v1 no longer serves calls. Add v2, check the mapping and run a test to keep serving calls.",
    );
  });

  it("sums a listing up in one line", () => {
    expect(servedSummary({ majors: [1, 2], provides: ["uv_index"], supports: ["units"] })).toBe(
      "Serves contract v1 and v2 · also returns uv_index · also accepts units",
    );
  });
});

describe("one test per major", () => {
  const choices = majorChoices(WEATHER);

  it("runs each major served against its newest version", () => {
    expect(testTargets({ majors: [1, 2], provides: [], supports: [] }, choices)).toEqual([
      { major: 1, version: 2, semver: "1.1.0" },
      { major: 2, version: 3, semver: "2.0.0" },
    ]);
  });

  it("runs once, with no version, against a backend that has none", () => {
    expect(testTargets({ majors: [1], provides: [], supports: [] }, [])).toEqual([{ major: 1, version: undefined, semver: null }]);
  });

  it("names a run by the version the server says it checked", () => {
    expect(runLabel(2, { toolVersionSemver: "2.0.0" }, null)).toBe("Contract v2 (2.0.0)");
    expect(runLabel(1, null, "1.1.0")).toBe("Contract v1 (1.1.0)");
    expect(runLabel(1, null, null)).toBe("Contract v1");
  });
});

describe("the publish check, one tester row per major", () => {
  const stake = { requirement: "STAKE_AT_MINIMUM_ON_EVERY_CHAIN" as const, met: true, code: null, detail: "ok" };

  it("splits the backend's 'Contract vN:' prefix", () => {
    expect(splitMajorDetail("Contract v2: No test run at this revision.")).toEqual({ major: 2, rest: "No test run at this revision." });
    expect(splitMajorDetail("Run at revision 3.")).toEqual({ major: null, rest: "Run at revision 3." });
    expect(splitMajorDetail(null)).toEqual({ major: null, rest: null });
  });

  it("shows a failing major by name and a passing one as passed", () => {
    const check: Pick<PublishCheck, "requirements"> = {
      requirements: [
        { requirement: "TESTER_RUN", met: false, code: "no_run", detail: "Contract v2: No test has run at revision 3 yet." },
        { requirement: "TESTER_PASSED", met: false, code: "no_run", detail: "Contract v2: Run a passing test first." },
        stake,
      ],
    };
    const rows = majorTestRows(check, [1, 2]);
    expect(rows.map(majorTestText)).toEqual(["Contract v1: tested and passed", "Contract v2: No test has run at revision 3 yet."]);
    expect(gateRows(check, [1, 2]).filter((r) => r.major === 2).map((r) => r.detail)).toEqual([
      "No test has run at revision 3 yet.",
      "Run a passing test first.",
    ]);
  });

  it("repeats a single passed row once per major", () => {
    const check: Pick<PublishCheck, "requirements"> = {
      requirements: [
        { requirement: "TESTER_RUN", met: true, code: null, detail: "Run at revision 3." },
        { requirement: "TESTER_PASSED", met: true, code: null, detail: "Every layer passed." },
        stake,
      ],
    };
    expect(gateRows(check, [1, 2]).filter((r) => r.requirement === "TESTER_PASSED").map((r) => r.major)).toEqual([1, 2]);
    expect(gateRows(check, [1, 2]).find((r) => r.requirement === "STAKE_AT_MINIMUM_ON_EVERY_CHAIN")?.major).toBeNull();
    expect(majorTestRows(check, [1, 2]).every((r) => r.met)).toBe(true);
  });
});

describe("PROVIDER_BINDING_CONTRACT_MISMATCH in plain words", () => {
  it.each([
    ["contract v3 has no published version to serve", "Version 3 of this tool doesn't exist yet, so you can't serve it. Untick v3."],
    [
      '"pm10" is not an optional output of the contract in ^1',
      '"pm10" isn\'t an extra field of version 1. Untick it under "Extra fields you return".',
    ],
    [
      '"lang" is not an optional input of the contract in ^1 || ^2',
      '"lang" isn\'t an extra input of versions 1 and 2. Untick it under "Extra inputs you accept".',
    ],
    [
      'the request mapping never reads "units", so it would be dropped',
      'You say you accept "units", but your mapping never sends it to your API. Add it under Advanced mapping, or untick it.',
    ],
    ['"^x" is not a version range (write ^1, or ^1 || ^2)', "Pick the versions you serve again."],
    ["something new", "Something new."],
  ])("%s", (problem, plain) => {
    expect(mismatchProblemText(problem)).toBe(plain);
  });

  it("reads the problems from the error's context, and ignores other errors", () => {
    const error = new ApiError("PROVIDER_BINDING_CONTRACT_MISMATCH", "x", 400, "/p", { problems: ["contract v3 has no published version to serve"] });
    expect(contractMismatchProblems(error)).toEqual(["Version 3 of this tool doesn't exist yet, so you can't serve it. Untick v3."]);
    expect(contractMismatchProblems(new ApiError("PROVIDER_BINDING_CONTRACT_MISMATCH", "x", 400))).toHaveLength(1);
    expect(contractMismatchProblems(new ApiError("TOOL_MAPPING_INVALID", "x", 400))).toBeNull();
    expect(contractMismatchProblems(new Error("x"))).toBeNull();
  });
});
