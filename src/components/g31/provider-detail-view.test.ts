import { describe, expect, it } from "vitest";

import { servedToolsLine } from "./provider-detail-view";

// BUG-R16-B3-02: the detail said "serves 0 tools" beside a list card saying 1.
describe("servedToolsLine", () => {
  it("does not claim zero while the catalogue entry is unknown", () => {
    expect(servedToolsLine(undefined)).toBe("tools served not known");
  });

  it("counts the same toolIds the list card counts", () => {
    expect(servedToolsLine(["06399979"])).toBe("serves 1 tool right now");
    expect(servedToolsLine(["a", "b"])).toBe("serves 2 tools right now");
  });

  it("says plainly when nothing is served right now", () => {
    expect(servedToolsLine([])).toBe("serves no tool right now");
  });
});
