import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ agentId: string; query: unknown }>);

vi.mock("@/services/account.service", () => ({
  listAgents: vi.fn(),
  listCredentials: vi.fn(async (agentId: string, query: unknown) => {
    calls.push({ agentId, query });
    return { items: [{ id: `key-${agentId}`, agentId }] };
  }),
}));

import { readAgentKeys } from "./use-agents";

describe("readAgentKeys", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("reads each agent's keys", async () => {
    const keys = await readAgentKeys(["a-1", "a-2"]);
    expect(Object.keys(keys)).toEqual(["a-1", "a-2"]);
    expect(keys["a-2"]).toEqual([{ id: "key-a-2", agentId: "a-2" }]);
  });

  it("asks for the same URL on every poll: no cache-buster", async () => {
    await readAgentKeys(["a-1"]);
    await readAgentKeys(["a-1"]);
    expect(calls).toEqual([
      { agentId: "a-1", query: { limit: 50 } },
      { agentId: "a-1", query: { limit: 50 } },
    ]);
  });
});
