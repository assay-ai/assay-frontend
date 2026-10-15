import { describe, expect, it } from "vitest";

import { rulingMissingText } from "./arbiter";
import { withoutParams } from "./url-params";

describe("withoutParams", () => {
  it("drops the one-shot params and keeps the rest", () => {
    expect(withoutParams("http://x.test/operator/blocks?new=1", ["new"])).toBe("/operator/blocks");
    expect(withoutParams("/operator/arbiter?case=c1&rule=uphold&focus=0xab#row", ["rule", "case"])).toBe("/operator/arbiter?focus=0xab#row");
    expect(withoutParams("/operator/operators", ["new"])).toBe("/operator/operators");
  });
});

describe("rulingMissingText", () => {
  const base = { warnings: 0, acknowledged: false, reason: "", note: "" };

  it("lists everything still missing at once", () => {
    expect(rulingMissingText({ ...base, warnings: 2 })).toBe(
      "Still needed: confirm the payee warnings, pick a reason and write at least 20 characters in the note.",
    );
    expect(rulingMissingText({ ...base, reason: "EVIDENCE" })).toBe("Still needed: write at least 20 characters in the note.");
  });

  it("is null when ready, and passes another form error through when nothing else is missing", () => {
    const ready = { ...base, warnings: 1, acknowledged: true, reason: "EVIDENCE", note: "x".repeat(20) };
    expect(rulingMissingText(ready)).toBeNull();
    expect(rulingMissingText({ ...ready, otherError: "A ticket is at most 128 characters." })).toBe("A ticket is at most 128 characters.");
  });
});
