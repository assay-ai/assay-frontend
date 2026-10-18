import { describe, expect, it } from "vitest";

import { freeSlugAmong, usedTools } from "./start-from-used";

// Review F: the buyer called three tools; only get_weather has a live provider.
const calls = [
  ...Array.from({ length: 5 }, () => ({ toolId: "weather" })),
  ...Array.from({ length: 3 }, () => ({ toolId: "geocode" })),
  { toolId: "rate" },
  { toolId: "removed" },
];
const listed = [{ toolId: "weather", name: "get_weather", routable: true }];
const known = new Map([
  ["weather", { name: "get_weather" }],
  ["geocode", { name: "geocode_place" }],
  ["rate", { name: "get_usd_eur_rate" }],
]);

describe("usedTools", () => {
  it("lists every used tool, most used first, tagging the ones that can't run", () => {
    const tools = usedTools(calls, listed, known);
    expect(tools.map((t) => [t.name, t.state, t.defaultOn, t.selectable])).toEqual([
      ["get_weather", "ready", true, true],
      ["geocode_place", "no-provider", false, true],
      ["get_usd_eur_rate", "no-provider", false, true],
      ["removed", "gone", false, false],
    ]);
    expect(tools[1].reason).toBe("no provider is taking calls for it now");
    expect(tools[3].reason).toBe("no longer on Assay");
  });

  it("a listed tool that isn't routable now is tagged, not hidden", () => {
    const [tool] = usedTools([{ toolId: "weather" }], [{ toolId: "weather", name: "get_weather", routable: false }], known);
    expect(tool).toMatchObject({ state: "no-provider", selectable: true, defaultOn: false });
  });

  it("never calls a tool gone while the tool index is still loading", () => {
    expect(usedTools([{ toolId: "geocode" }], [], new Map())[0]).toMatchObject({ state: "no-provider", name: "geocode", selectable: true });
  });
});

describe("freeSlugAmong", () => {
  it("keeps a free slug and numbers a taken one, as the server does", () => {
    expect(freeSlugAmong("tools-i-use", [])).toBe("tools-i-use");
    expect(freeSlugAmong("tools-i-use", ["tools-i-use", "tools-i-use-2"])).toBe("tools-i-use-3");
    expect(freeSlugAmong("a".repeat(64), ["a".repeat(64)])).toBe(`${"a".repeat(62)}-2`);
  });
});
