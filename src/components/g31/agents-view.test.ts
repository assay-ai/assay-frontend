import { describe, expect, it } from "vitest";

import type { AgentReadiness } from "@/features/buyer-money/agent-readiness";

import { revokeKeyText, withLabel } from "./agents-view";

const agent = { agentId: "a", label: "prod" };
const key = (delegateAccount: string | null) => ({
  id: "k1",
  agentId: "a",
  name: "orchestrator",
  prefix: "assay",
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
  it("on the key the agent pays through: two short sentences, the on-chain detail apart", () => {
    const { text, detail } = revokeKeyText(agent, key("eip155:1:0xd"), paying);
    expect(text).toBe("prod can no longer call any tool with this key, free or paid. This cannot be undone; you can create a new key.");
    expect(detail).toContain("Its on-chain permission to pay is not removed by this: Stop it paying removes it");
    expect(detail).not.toContain("can still be collected");
  });
  it("says how long signed payments stay collectable on a D-21 escrow", () => {
    expect(revokeKeyText(agent, key("eip155:1:0xd"), paying, 3600).detail).toContain(
      "After that, payments it already signed can still be collected for 1 hour.",
    );
  });
  it("on a key with no payment key", () => {
    const { text, detail } = revokeKeyText(agent, key(null), undefined);
    expect(text).toContain("free or paid");
    expect(detail).toContain("Nothing about paying changes");
  });
});

describe("withLabel — a rename patched into the agents cache", () => {
  it("replaces one agent's label and leaves the rest", () => {
    const page = { items: [{ agentId: "a", label: "My agent" }, { agentId: "b", label: "other" }], pageInfo: { hasMore: false } };
    expect(withLabel(page, "a", "Research bot")).toEqual({
      items: [{ agentId: "a", label: "Research bot" }, { agentId: "b", label: "other" }],
      pageInfo: { hasMore: false },
    });
  });
  it("leaves anything that is not a page alone", () => {
    expect(withLabel(undefined, "a", "x")).toBeUndefined();
    expect(withLabel({ chainId: "eip155:1" }, "a", "x")).toEqual({ chainId: "eip155:1" });
  });
});
