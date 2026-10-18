import { describe, expect, it } from "vitest";

import { failureSentence } from "./failure-sentence";

describe("a window's failures, as sentences", () => {
  it("does not offer the deciding rule as the reason", () => {
    const line = failureSentence({ key: "quorum_failures_at_least", count: 1 });
    expect(line).toBe("1 call failed our checks (which rule: see Checked calls below)");
    expect(line).not.toMatch(/Enough checks failed/);
  });

  it("names a real reason and counts calls", () => {
    expect(failureSentence({ key: "VALUE_RANGE", count: 3 })).toMatch(/^3 calls failed: [a-z]/);
  });
});
