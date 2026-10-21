import { describe, expect, it } from "vitest";

import { nothingWithheldHeading, notRunSentence, partOfLine } from "./guarantee-copy";

describe("guarantee copy", () => {
  it("only says every call passed when no call ended without running (BUG-BUY-MONEY-01)", () => {
    expect(nothingWithheldHeading(0)).toBe("Every call this month passed");
    expect(nothingWithheldHeading(2)).toBe("No call this month failed our checks");
  });
  it("tells calls that did not run apart, in the singular too", () => {
    expect(notRunSentence(2)).toMatch(/^Separately, 2 calls this month did not run/);
    expect(notRunSentence(1)).toMatch(/^Separately, 1 call this month did not run/);
    expect(notRunSentence(2)).toMatch(/nothing was held and nothing was charged/);
  });
  it("counts a nested reason as a part of its line, not a second count (BUG-X-01)", () => {
    expect(partOfLine(4, 4)).toBe("4 of 4 calls");
    expect(partOfLine(1, 5)).toBe("1 of 5 calls");
    expect(partOfLine(1, 1)).toBe("1 of 1 call");
    // The fold and the ledger can disagree: then a plain count.
    expect(partOfLine(3, 0)).toBe("3 calls");
    expect(partOfLine(6, 5)).toBe("6 calls");
  });
});
