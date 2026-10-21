import { describe, expect, it } from "vitest";

import type { AgentAccess } from "@/services/toolsets.service";

import { accessSummary, blockSwitchesToList, nextAccessBody, toolAccess } from "./tool-access";

function access(over: Partial<AgentAccess> = {}): AgentAccess {
  return {
    agentId: "agent-1",
    scope: "AGENT",
    policyVersion: 3,
    accessMode: "ALL",
    allowedToolsets: [],
    allowedToolIds: [],
    rules: { excludeProviderIds: [], maxPrice: null, minTier: null, minQuality: null },
    pinnedTools: [],
    tools: ["a", "b", "c"].map((id) => ({
      toolId: id,
      name: `tool_${id}`,
      category: "web",
      access: "ALLOWED" as const,
      providersTotal: 2,
      providersLeft: 2,
    })),
    ...over,
  };
}

describe("tool access (Explore's Allow / Block)", () => {
  it("reads Everything as allowed, and Only these by its list and tool sets", () => {
    expect(toolAccess(access(), "a")).toBe("allowed");
    expect(toolAccess(null, "a")).toBe("allowed");
    const only = access({
      accessMode: "RESTRICTED",
      allowedToolIds: ["b"],
      tools: access().tools.map((t) => ({ ...t, access: t.toolId === "b" ? "ALLOWED" : t.toolId === "c" ? "VIA_TOOLSET_URL" : "BLOCKED" })),
    });
    expect(toolAccess(only, "a")).toBe("blocked");
    expect(toolAccess(only, "b")).toBe("allowed");
    expect(toolAccess(only, "c")).toBe("via-toolset");
  });

  it("blocking from Everything becomes Only these, every other tool, and says so", () => {
    expect(blockSwitchesToList(access())).toBe(true);
    expect(nextAccessBody(access(), "b", "tool_b", false)).toEqual({
      accessMode: "RESTRICTED",
      allowedToolIds: ["a", "c"],
      changeReason: "Blocked tool_b from Explore",
    });
  });

  it("allows and blocks one tool on Only these", () => {
    const only = access({ accessMode: "RESTRICTED", allowedToolIds: ["a"] });
    expect(nextAccessBody(only, "b", "tool_b", true)?.allowedToolIds).toEqual(["a", "b"]);
    expect(nextAccessBody(only, "a", "tool_a", false)?.allowedToolIds).toEqual([]);
  });

  it("changes nothing when the tool is already in that state", () => {
    expect(nextAccessBody(access(), "a", "tool_a", true)).toBeUndefined();
    expect(nextAccessBody(access({ accessMode: "RESTRICTED", allowedToolIds: ["a"] }), "b", "tool_b", false)).toBeUndefined();
  });

  it("states the result for the agent", () => {
    expect(accessSummary(access(), "prod")).toMatch(/prod can use every tool/);
    const only = access({
      accessMode: "RESTRICTED",
      tools: access().tools.map((t) => ({ ...t, access: t.toolId === "a" ? "BLOCKED" : "ALLOWED" })),
    });
    expect(accessSummary(only, "prod")).toBe("prod can use 2 of 3 tools. New tools need allowing.");
    expect(accessSummary(access({ accessMode: "RESTRICTED", tools: access().tools.map((t) => ({ ...t, access: "BLOCKED" })) }), "prod")).toMatch(
      /cannot use any tool/,
    );
  });
});
