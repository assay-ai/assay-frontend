import { describe, expect, it } from "vitest";

import { accessSummary, blockSwitchesToList, nextAllowedTools, toolAccess } from "./tool-access";

const ALL = ["a", "b", "c"];

describe("tool access", () => {
  it("reads null as every tool and a list as only those", () => {
    expect(toolAccess(null, "a")).toBe("allowed");
    expect(toolAccess(["b"], "a")).toBe("blocked");
    expect(toolAccess([], "a")).toBe("blocked");
  });

  it("blocking from 'every tool' becomes the list of the others, and says so", () => {
    expect(blockSwitchesToList(null)).toBe(true);
    expect(nextAllowedTools(null, ALL, "b", false)).toEqual(["a", "c"]);
  });

  it("allowing back every known tool returns to 'every tool'", () => {
    expect(nextAllowedTools(["a", "c"], ALL, "b", true)).toBeNull();
    expect(nextAllowedTools(["a"], ALL, "b", true)).toEqual(["a", "b"]);
  });

  it("changes nothing when the tool is already in that state", () => {
    expect(nextAllowedTools(null, ALL, "a", true)).toBeUndefined();
    expect(nextAllowedTools(["a"], ALL, "b", false)).toBeUndefined();
  });

  it("states the resulting policy", () => {
    expect(accessSummary(null, 3)).toMatch(/every tool/);
    expect(accessSummary(["a", "c"], 3)).toBe("Your agents can use 2 of 3 tools. New tools need allowing.");
  });
});
