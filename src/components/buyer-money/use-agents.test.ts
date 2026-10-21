import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as unknown[]);
const answer = vi.hoisted(() => ({ items: [] as unknown[] }));
const refuseInclude = vi.hoisted(() => ({ error: null as unknown }));

vi.mock("@/services/account.service", () => ({
  listAgents: vi.fn(async (query: { include?: string }) => {
    calls.push(query);
    if (query.include && refuseInclude.error) throw refuseInclude.error;
    return answer;
  }),
}));

import { ApiError } from "@/libs/ApiClient";
import { demoAgentHealth } from "@/libs/demo/demo-agent-health";

import { healthByAgent, keysByAgent, readAgentsWithKeys } from "./use-agents";

const key = (id: string, agentId: string) => ({ id, agentId, revokedAt: null, expiresAt: null, lastUsedAt: null, delegateAccount: null });

describe("readAgentsWithKeys", () => {
  beforeEach(() => {
    calls.length = 0;
    answer.items = [];
    refuseInclude.error = null;
  });

  it("reads every agent with its keys and their health in one request", async () => {
    answer.items = [
      { agentId: "a-1", credentials: { items: [key("k-1", "a-1")], hasMore: false }, health: demoAgentHealth([key("k-1", "a-1")]) },
      { agentId: "a-2", credentials: { items: [], hasMore: false }, health: demoAgentHealth([]) },
    ];
    const page = await readAgentsWithKeys();
    expect(calls).toEqual([{ limit: 50, include: "credentials,health" }]);
    expect(keysByAgent(page)).toEqual({ "a-1": [key("k-1", "a-1")], "a-2": [] });
    expect(healthByAgent(page)["a-1"]?.unrevokedKeyCount).toBe(1);
  });

  it("asks for the same URL on every poll: no cache-buster", async () => {
    await readAgentsWithKeys();
    await readAgentsWithKeys();
    expect(calls).toEqual([
      { limit: 50, include: "credentials,health" },
      { limit: 50, include: "credentials,health" },
    ]);
  });

  it("refuses a row without its keys rather than reading it as 'No key'", async () => {
    answer.items = [{ agentId: "a-1" }];
    await expect(readAgentsWithKeys()).rejects.toMatchObject({ code: "AGENT_KEYS_MISSING" });
  });

  // BUG-DEMO-02: an agent-kind session may read the list but not the keys.
  it("falls back to the plain list when the keys are refused, and marks them hidden", async () => {
    refuseInclude.error = new ApiError("AUTH_HUMAN_SESSION_REQUIRED", "needs a person", 403);
    answer.items = [{ agentId: "a-1", label: "Funded" }];
    const page = await readAgentsWithKeys();
    expect(calls).toEqual([{ limit: 50, include: "credentials,health" }, { limit: 50 }]);
    expect(page.keysHidden).toBe(true);
    expect(page.items.map((agent) => agent.agentId)).toEqual(["a-1"]);
    // Hidden keys are unknown, never "no key".
    expect(keysByAgent(page)).toEqual({});
    expect(healthByAgent(page)).toEqual({});
  });

  it("does not fall back for a blocked account or another failure", async () => {
    refuseInclude.error = new ApiError("ACCOUNT_BLOCKED", "blocked", 403);
    await expect(readAgentsWithKeys()).rejects.toMatchObject({ code: "ACCOUNT_BLOCKED" });
    refuseInclude.error = new ApiError("INTERNAL_ERROR", "boom", 500);
    await expect(readAgentsWithKeys()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(calls.every((query) => (query as { include?: string }).include === "credentials,health")).toBe(true);
  });
});
