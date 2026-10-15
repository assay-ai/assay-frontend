import { describe, expect, it } from "vitest";

import type { AgentReadiness } from "@/features/buyer-money/agent-readiness";

import { revokeKeyText } from "./agents-view";

const agent = { agentId: "a", label: "prod" };
const key = (delegateAccount: string | null) => ({
  id: "k1",
  agentId: "a",
  name: "orchestrator",
  prefix: "x402",
  scopes: [],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  delegateAccount,
  createdAt: "",
});
const paying = {
  boundCredential: { id: "k1" },
  grant: { status: "ACTIVE" },
} as unknown as AgentReadiness;

describe("Revoke key says whether paying stops too", () => {
  it("on the key the agent pays through", () => {
    expect(revokeKeyText(agent, key("eip155:1:0xd"), paying)).toContain("Paying stops too");
  });
  it("on a key with no payment key", () => {
    const text = revokeKeyText(agent, key(null), undefined);
    expect(text).toContain("free or paid");
    expect(text).toContain("Nothing about paying changes");
  });
});
