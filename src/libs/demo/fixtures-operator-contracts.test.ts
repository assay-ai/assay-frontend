import { describe, expect, it, vi } from "vitest";

import type { OperatorTool, OperatorToolList } from "@/interfaces/contracts";
import type { OperatorApproval } from "@/interfaces/operator";

import { GEOCODE_TOOL_ID, TIDES_TOOL_ID, WEATHER_TOOL_ID } from "./fixtures-contracts";

/*
  The demo's contract editor endpoints: a tool with versions 1.x and 2.0
  (major 1 deprecated), a newer major ready to be the default, a draft tool
  from a tool request, a save that answers with its diff, and the two
  two-person actions answering as a 202 (a request waiting for approval).
*/

type Fixtures = typeof import("./fixtures-operator");

async function load(): Promise<Fixtures> {
  vi.resetModules();
  // The catalogue's tools register themselves for the operator list when the explore fixtures load.
  await import("./fixtures");
  return import("./fixtures-operator");
}

function call<T>(fixtures: Fixtures, method: string, path: string, data: Record<string, unknown> = {}): T {
  const found = fixtures.OPERATOR_FIXTURES.find((f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path));
  if (!found) throw new Error(`no fixture for ${method} ${path}`);
  return found.body(path, {}, data) as T;
}

describe("demo contract editor", () => {
  it("lists every catalogue tool, the three stories first-class", async () => {
    const f = await load();
    const list = call<OperatorToolList>(f, "GET", "/operator/tools");
    const byId = new Map(list.tools.map((t) => [t.id, t]));
    expect(byId.get(WEATHER_TOOL_ID)).toMatchObject({ name: "get_weather", currentSemver: "2.0.0", hasDraft: true });
    expect(byId.get(GEOCODE_TOOL_ID)).toMatchObject({ currentSemver: "1.0.0", hasDraft: false });
    expect(byId.get(TIDES_TOOL_ID)).toMatchObject({ status: "DRAFT", currentSemver: null, hasDraft: true });
    expect(list.tools.length).toBeGreaterThan(5);
  });

  it("has get_weather on 1.x and 2.0, with major 1 deprecated and its sunset past the 90-day notice", async () => {
    const f = await load();
    const tool = call<OperatorTool>(f, "GET", `/operator/tools/${WEATHER_TOOL_ID}`);
    expect(tool.versions.map((v) => `${v.semver}:${v.status}`)).toEqual(["2.0.0:ACTIVE", "1.1.0:DEPRECATED", "1.0.0:DEPRECATED"]);
    const days = (Date.parse(tool.versions[1]!.sunsetAt!) - Date.now()) / 86_400_000;
    // A fixed calendar date (weatherSunsetAt), never under the 90-day notice.
    expect(days).toBeGreaterThan(90);
    expect(tool.majors.map((m) => m.major)).toEqual([2, 1]);
    expect(tool.draft).toMatchObject({ baseSemver: "2.0.0", nextSemver: "2.1.0", bump: "MINOR", problems: [] });
  });

  it("answers a save with the server's diff of what was sent", async () => {
    const f = await load();
    const tool = call<OperatorTool>(f, "GET", `/operator/tools/${GEOCODE_TOOL_ID}`);
    const base = tool.versions[0]!;
    const saved = call<OperatorTool>(f, "POST", `/operator/tools/${GEOCODE_TOOL_ID}/versions`, {
      summary: base.summary,
      description: base.description,
      inputSchema: base.inputSchema,
      outputSchema: { ...base.outputSchema, properties: {} , required: [] },
      examples: [],
    });
    expect(saved.draft).toMatchObject({ bump: "MAJOR", nextSemver: "3.0.0" });
    // …and remembers it for the tab, until it is discarded.
    expect(call<OperatorTool>(f, "GET", `/operator/tools/${GEOCODE_TOOL_ID}`).draft?.nextSemver).toBe("3.0.0");
    expect(call<OperatorTool>(f, "DELETE", `/operator/tools/${GEOCODE_TOOL_ID}/versions/draft`).draft).toBeNull();
  });

  it("queues a publish and a default change for a second operator, as a 202", async () => {
    const f = await load();
    const body = { reasonCode: "PLANNED_CHANGE", note: "Adding humidity for the travel agents." };
    const queued = call<{ approvalId: string; status: string; action: string }>(f, "POST", `/operator/tools/${WEATHER_TOOL_ID}/versions/4/publish`, body);
    expect(queued).toMatchObject({ status: "PENDING", action: "tool_version.publish" });
    const current = call<{ status: string; action: string }>(f, "POST", `/operator/tools/${GEOCODE_TOOL_ID}/current-version`, { ...body, version: 2 });
    expect(current).toMatchObject({ status: "PENDING", action: "tool.current_version" });
    const pending = call<{ items: OperatorApproval[] }>(f, "GET", "/operator/approvals");
    expect(pending.items.filter((a) => a.target.startsWith("tool:")).map((a) => a.code).sort()).toEqual(["P-10", "P-11"]);
  });

  it("publishes the draft once approved: a minor of the default major becomes the default", async () => {
    const f = await load();
    const queued = call<{ approvalId: string }>(f, "POST", `/operator/tools/${WEATHER_TOOL_ID}/versions/4/publish`, { reasonCode: "OTHER", note: "x".repeat(20) });
    call(f, "POST", `/operator/approvals/${queued.approvalId}/approve`);
    const tool = call<OperatorTool>(f, "GET", `/operator/tools/${WEATHER_TOOL_ID}`);
    expect(tool.draft).toBeNull();
    expect(tool.currentSemver).toBe("2.1.0");
  });

  it("deprecates a major with its sunset", async () => {
    const f = await load();
    const tool = call<OperatorTool>(f, "POST", `/operator/tools/${GEOCODE_TOOL_ID}/versions/1/deprecate`, {
      sunsetAt: "2027-03-01T00:00:00Z",
      reasonCode: "REPLACED_BY_NEWER",
      note: "v2 serves every caller now.",
    });
    expect(tool.versions.find((v) => v.semver === "1.0.0")).toMatchObject({ status: "DEPRECATED", sunsetAt: "2027-03-01T00:00:00Z" });
  });

  it("creates a draft tool from an accepted tool request", async () => {
    const f = await load();
    const queue = call<{ items: { id: string; title: string }[] }>(f, "GET", "/operator/tool-requests");
    expect(queue.items.length).toBe(2);
    const answer = call<{ status: string; toolId: string }>(f, "PATCH", `/operator/tool-requests/${queue.items[0]!.id}`, {
      status: "ACCEPTED",
      resolutionNote: "Accepted.",
      toolName: "get_air_quality",
      toolCategory: "weather",
    });
    expect(answer.status).toBe("ACCEPTED");
    const tool = call<OperatorTool>(f, "GET", `/operator/tools/${answer.toolId}`);
    expect(tool).toMatchObject({ name: "get_air_quality", status: "DRAFT", versions: [], draft: null });
    expect(call<{ items: unknown[] }>(f, "GET", "/operator/tool-requests").items.length).toBe(1);
  });
});
