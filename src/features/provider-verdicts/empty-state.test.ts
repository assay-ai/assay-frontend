import { describe, expect, it } from "vitest";

import { DEFAULT_VERDICT_SEGMENT, verdictEmptyState } from "./empty-state";

// BUG-R3-J-01: a binding with one PASSED call opened on "failed" and was told
// "Nothing has been judged in this scope yet".
describe("verdict feed empty state", () => {
  it("opens on every verdict, so a healthy binding shows its calls", () => {
    expect(DEFAULT_VERDICT_SEGMENT).toBe("all");
  });

  it("names the verdict filter instead of claiming nothing was judged", () => {
    const state = verdictEmptyState({
      segment: "failed",
      windowLabel: "w_1",
      filtersApplied: false,
      searching: false,
    });
    expect(state.title).toBe("No failed verdicts in window w_1");
    expect(state.description).not.toMatch(/nothing has been judged/i);
    expect(state.description).toMatch(/"all"/);
  });

  it("says nothing was judged only when no filter narrows the feed", () => {
    expect(
      verdictEmptyState({ segment: "all", windowLabel: "w_1", filtersApplied: false, searching: false })
    ).toEqual({
      title: "No verdicts in window w_1",
      description:
        "A verdict appears here the moment a call against this binding is judged. Nothing has been judged in this window yet.",
    });
    expect(
      verdictEmptyState({ segment: "all", windowLabel: null, filtersApplied: false, searching: false }).title
    ).toBe("No verdicts yet");
  });

  it("blames the sheet filters or the search when they are what hides the rows", () => {
    expect(
      verdictEmptyState({ segment: "all", windowLabel: null, filtersApplied: true, searching: false }).title
    ).toBe("No verdicts match these filters");
    expect(
      verdictEmptyState({ segment: "passed", windowLabel: "w_2", filtersApplied: false, searching: true }).title
    ).toBe("No verdicts match this search");
  });
});
