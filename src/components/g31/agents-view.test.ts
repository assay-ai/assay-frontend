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
    const text = revokeKeyText(agent, key("eip155:1:0xd"), paying);
    expect(text).toContain("it makes no more paid calls through Assay");
    expect(text).toContain("Its on-chain permission to pay is not removed by this: Stop it paying removes it.");
    expect(text).not.toContain("Paying stops too");
    expect(text).not.toContain("can still be collected");
  });
  it("says how long signed payments stay collectable on a D-21 escrow", () => {
    expect(revokeKeyText(agent, key("eip155:1:0xd"), paying, 3600)).toContain(
      "If you then Stop it paying, payments it already signed can still be collected for 1 hour.",
    );
  });
  it("on a key with no payment key", () => {
    const text = revokeKeyText(agent, key(null), undefined);
    expect(text).toContain("free or paid");
    expect(text).toContain("Nothing about paying changes");
  });
});
