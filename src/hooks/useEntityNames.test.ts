import { describe, expect, it } from "vitest";

import { buildEntityIndex, entityName } from "./useEntityNames";

describe("entity names", () => {
  const index = buildEntityIndex({
    tools: [{ id: "t1", name: "search_web" }, { id: "t2", name: "  " }],
    providers: [{ providerId: "p1", legalName: "Searchly Ltd" }],
    agents: [{ agentId: "a1", label: "prod runner" }, { agentId: "a2" }],
    credentialsByAgent: {
      a1: [{ id: "c1", name: "laptop" }, { id: "c2", name: null }],
      a2: [{ id: "c3", name: "ci" }],
    },
  });

  it("resolves each kind", () => {
    expect(entityName(index, "tool", "t1")).toBe("search_web");
    expect(entityName(index, "provider", "p1")).toBe("Searchly Ltd");
    expect(entityName(index, "agent", "a1")).toBe("prod runner");
  });

  it("names a key by its agent and its own name", () => {
    expect(entityName(index, "credential", "c1")).toBe("prod runner · laptop");
    expect(entityName(index, "credential", "c2")).toBe("prod runner");
    expect(entityName(index, "credential", "c3")).toBe("ci");
  });

  it("returns null (so the caller shows the id) for unknown, blank or empty ids", () => {
    expect(entityName(index, "tool", "t2")).toBeNull();
    expect(entityName(index, "tool", "nope")).toBeNull();
    expect(entityName(index, "agent", "a2")).toBeNull();
    expect(entityName(index, "tool", null)).toBeNull();
  });

  it("is empty before anything loads", () => {
    expect(entityName(buildEntityIndex({}), "tool", "t1")).toBeNull();
  });
});
