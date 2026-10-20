import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as unknown[]);
const answer = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock("@/services/account.service", () => ({
  listAgents: vi.fn(async (query: unknown) => {
    calls.push(query);
    return answer;
  }),
}));

import { demoAgentHealth } from "@/libs/demo/demo-agent-health";

import { healthByAgent, keysByAgent, readAgentsWithKeys } from "./use-agents";

const key = (id: string, agentId: string) => ({ id, agentId, revokedAt: null, expiresAt: null, lastUsedAt: null, delegateAccount: null });

describe("readAgentsWithKeys", () => {
  beforeEach(() => {
    calls.length = 0;
    answer.items = [];
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
});
