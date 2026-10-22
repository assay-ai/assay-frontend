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

  // A row without its keys is never read as "No key".
  it("marks a row without its keys hidden rather than reading it as 'No key'", async () => {
    answer.items = [
      { agentId: "a-1", credentials: { items: [key("k-1", "a-1")], hasMore: false }, health: demoAgentHealth([key("k-1", "a-1")]) },
      { agentId: "a-2" },
    ];
    const page = await readAgentsWithKeys();
    expect(page.keysHiddenFor).toEqual(["a-2"]);
    expect(keysByAgent(page)).toEqual({ "a-1": [key("k-1", "a-1")] });
    expect(Object.keys(healthByAgent(page))).toEqual(["a-1"]);
  });

  // The list is a person's read: an agent key is refused it whole, and nothing else is read instead.
  it("passes an agent key's refusal on, without a keyless second read", async () => {
    refuseInclude.error = new ApiError("AUTH_HUMAN_SESSION_REQUIRED", "needs a person", 403);
    await expect(readAgentsWithKeys()).rejects.toMatchObject({ code: "AUTH_HUMAN_SESSION_REQUIRED" });
    expect(calls).toEqual([{ limit: 50, include: "credentials,health" }]);
  });

  it("passes a blocked account or another failure on", async () => {
    refuseInclude.error = new ApiError("ACCOUNT_BLOCKED", "blocked", 403);
    await expect(readAgentsWithKeys()).rejects.toMatchObject({ code: "ACCOUNT_BLOCKED" });
    refuseInclude.error = new ApiError("INTERNAL_ERROR", "boom", 500);
    await expect(readAgentsWithKeys()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(calls.every((query) => (query as { include?: string }).include === "credentials,health")).toBe(true);
  });
});
