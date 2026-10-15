import { describe, expect, it } from "vitest";

import type { Money } from "@/interfaces/api";

import { roleCapabilityLists, roleLimitText, rolePillText } from "./role-intro";

const usd = (dollars: number): Money => ({ amount: String(dollars * 1_000_000), asset: "USDC", decimals: 6 });

describe("the role pill and strip", () => {
  it("names the role and the limit for roles that act on money", () => {
    expect(rolePillText({ roles: ["ADJL"], authorityLimit: usd(1000) })).toBe("Lead adjudicator · $1,000");
    expect(roleLimitText({ roles: ["SRE", "SUP"], authorityLimit: usd(0) })).toBe("$0 limit");
  });

  it("leaves the limit out for a role that never acts on money", () => {
    expect(rolePillText({ roles: ["OPS_ADMIN"], authorityLimit: usd(0) })).toBe("Admin");
    expect(roleLimitText({ roles: ["OPS_ADMIN"], authorityLimit: usd(0) })).toBeNull();
  });
});

describe("roleCapabilityLists", () => {
  it("lists what a Lead can do, with the limit on money actions, and what needs someone else", () => {
    const { can, others } = roleCapabilityLists({ roles: ["ADJL"], authorityLimit: usd(1000) });
    expect(can).toContain("suspend a penalty up to $1,000");
    expect(can.some((item) => item.startsWith("approve "))).toBe(true);
    expect(others).toContain("add and change operators (Admin)");
  });

  it("says a $0 limit is why, not the role", () => {
    const { others } = roleCapabilityLists({ roles: ["SRE", "SUP"], authorityLimit: usd(0) });
    expect(others).toContain("suspend a penalty (your limit is $0)");
  });
});
