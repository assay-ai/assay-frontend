import { describe, expect, it } from "vitest";

import type { CatalogueTool } from "@/services/tools.service";

import { nameFrom, shortToolId, toolNameIndex } from "./use-tool-names";

/**
 * `toolId` → the name a person recognises.
 *
 * The screens print `nameOf(call.toolId)` and never touch the raw id again, so
 * everything about how a missing name degrades lives in these two functions.
 * The rule being pinned is that **a missing name is never a missing row**: the
 * catalogue can be empty (first render), stale (a tool retired since the call)
 * or unreachable (an older backend with no `GET /tools`), and in all three the
 * screen keeps rendering with the uuid it printed before this existed.
 */

const WEATHER: CatalogueTool = {
  id: "06399979-f8b8-4c9e-a9b1-bd2a5924d442",
  name: "get_weather",
  description: "Current temperature at a latitude/longitude.",
  tier: "VERIFIED",
};

describe("nameFrom", () => {
  it("names a tool the catalogue knows", () => {
    expect(nameFrom(toolNameIndex([WEATHER]), WEATHER.id)).toBe("get_weather");
  });

  it("falls back to the id, not to a placeholder", () => {
    const retired = "a4b9882a-9bc1-4d64-807a-27c0b93daf0a";

    expect(nameFrom(toolNameIndex([WEATHER]), retired)).toBe(retired);
  });

  /** The first render, and every render after a failed fetch. */
  it("falls back for every id when the catalogue is empty", () => {
    expect(nameFrom(toolNameIndex([]), WEATHER.id)).toBe(WEATHER.id);
  });
});

describe("shortToolId", () => {
  it("keeps the first segment, which is what a log line is recognised by", () => {
    expect(shortToolId(WEATHER.id)).toBe("06399979…");
  });

  /**
   * A tool id is not required to be a uuid — `ToolSummaryDto.id` is a string,
   * and the seed catalogue has carried slugs. An id with nothing to trim is
   * printed whole rather than being given a lying ellipsis.
   */
  it("leaves an id with no segments alone", () => {
    expect(shortToolId("search_web")).toBe("search_web");
  });
});
