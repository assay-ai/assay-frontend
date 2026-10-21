import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entryContractWarning } from "@/features/contracts/entry-contract";
import type { PublicToolsetPage } from "@/services/public-toolsets.service";
import type { CursorPage } from "@/interfaces";
import type { Toolset, ToolsetSummary } from "@/services/toolsets.service";

import { DEMO_FIXTURES } from "./fixtures";
import { WEATHER_TOOL_ID, demoVersionFields } from "./fixtures-contracts";
import { resetDemoToolsets, TOOLSET_FIXTURES } from "./fixtures-toolsets";

function call<T>(method: string, path: string, data?: Record<string, unknown>): T {
  const fixture = [...TOOLSET_FIXTURES, ...DEMO_FIXTURES].find((f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path));
  if (!fixture) throw new Error(`no fixture for ${method} ${path}`);
  return fixture.body(path, {}, data) as T;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MCP_URL", "");
  resetDemoToolsets();
});
afterEach(() => vi.unstubAllEnvs());

describe("demo fixtures: tool set entries with contract terms (T3)", () => {
  it("Weather and places routes get_weather to v1 and must return uv_index, so the row warns and offers Allow v2", () => {
    const list = call<CursorPage<ToolsetSummary>>("GET", "/toolsets");
    const summary = list.items.find((t) => t.slug === "weather")!;
    const set = call<Toolset>("GET", `/toolsets/${summary.id}`);
    const weather = set.entries.find((e) => e.toolId === WEATHER_TOOL_ID)!;
    expect(weather).toMatchObject({ toolVersionRange: "^1", requireOutputFields: ["uv_index"] });
    // Every other entry follows its tool's current major.
    expect(set.entries.find((e) => e.toolName === "geocode_place")?.toolVersionRange).toBe("^1");
    const warning = entryContractWarning(weather.toolVersionRange, demoVersionFields(WEATHER_TOOL_ID, "get_weather", "").versions);
    expect(warning?.fix).toEqual({ label: "Allow v2", range: "^1 || ^2" });
  });

  it("a save echoes the terms it was sent, and a new entry gets the current major", () => {
    const list = call<CursorPage<ToolsetSummary>>("GET", "/toolsets");
    const id = list.items.find((t) => t.slug === "weather")!.id;
    const next = call<Toolset>("PUT", `/toolsets/${id}/entries`, {
      entries: [{ toolId: WEATHER_TOOL_ID, providerMode: "BEST", providerIds: [], minTier: null, maxPrice: null, minQuality: null, onEmpty: "FAIL", requireOutputFields: ["uv_index"] }],
    });
    expect(next.entries[0]).toMatchObject({ toolVersionRange: "^2", requireOutputFields: ["uv_index"] });
  });

  it("the public Weather and places page shows Must return on get_weather", () => {
    const page = call<PublicToolsetPage>("GET", "/public/toolsets/@assay/weather-and-places");
    expect(page.entries.find((e) => e.toolName === "get_weather")).toMatchObject({ requireOutputFields: ["uv_index"], toolVersionRange: "^2" });
  });
});
