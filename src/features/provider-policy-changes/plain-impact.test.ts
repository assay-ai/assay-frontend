import { describe, expect, it } from "vitest";

import { overallImpact, plainImpact } from "./plain-impact";

describe("plainImpact", () => {
  it("reads a higher threshold as stricter", () => {
    const impact = plainImpact({ path: "$.threshold", changeType: "changed", before: 0.65, after: 0.7 });
    expect(impact.direction).toBe("stricter");
    expect(impact.text).toMatch(/stricter/);
    expect(impact.text).toMatch(/failure rate could rise/);
  });

  it("reads a lower threshold as more lenient", () => {
    expect(plainImpact({ path: "$.threshold", changeType: "changed", before: 0.7, after: 0.6 }).direction).toBe("looser");
  });

  it("names an added check", () => {
    const impact = plainImpact({ path: "$.verifiers[2]", changeType: "added", after: { verifierId: "xcheck.second-source", weight: 0.2 } });
    expect(impact.text).toBe("One more check (second source) runs on each result. A result now has one more way to fail.");
  });

  it("describes a changed clause limit without raw paths", () => {
    const impact = plainImpact({ path: "$.clauses[0].value", changeType: "changed", before: 2, after: 1 });
    expect(impact.text).toBe("A rule's limit changes from 2 to 1.");
    expect(impact.text).not.toMatch(/\$\./);
  });

  it("falls back to a neutral sentence", () => {
    expect(plainImpact({ path: "$.foo", changeType: "changed", before: "a", after: "b" }).text).toBe("A setting of the checks changes.");
  });
});

describe("overallImpact", () => {
  it("summarises the direction", () => {
    expect(
      overallImpact([
        { path: "$.threshold", changeType: "changed", before: 0.65, after: 0.7 },
        { path: "$.clauses[0].value", changeType: "changed", before: 2, after: 1 },
      ]),
    ).toMatch(/stricter/);
    expect(overallImpact([])).toMatch(/Nothing/);
  });
});
