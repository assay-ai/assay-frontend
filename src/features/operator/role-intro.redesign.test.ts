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

  it("says blocking in one line for Support / on-call, not 'Block an account' and 'Block a wallet on chain'", () => {
    const { can, others } = roleCapabilityLists({ roles: ["SRE", "SUP"], authorityLimit: usd(0) });
    expect([...can, ...others].filter((item) => item.includes("block"))).toEqual(["block an account (a wallet also on chain)"]);
  });

  it("says what the other half needs when a role can block only one way", () => {
    const { can } = roleCapabilityLists({ roles: ["TRE"], authorityLimit: usd(1000) });
    expect(can).toContain("block a wallet on chain (in Assay too needs Lead adjudicator or Support / on-call)");
    const admin = roleCapabilityLists({ roles: ["OPS_ADMIN"], authorityLimit: usd(0) });
    expect(admin.others.filter((item) => item.includes("block"))).toEqual([
      "block an account (Lead adjudicator or Support / on-call; on chain: Lead adjudicator, Support / on-call or Treasury)",
    ]);
  });

  it("says blocking in one line for a Lead, who can do both", () => {
    const { can, others } = roleCapabilityLists({ roles: ["ADJL"], authorityLimit: usd(1000) });
    expect(can).toContain("block an account (a wallet also on chain)");
    expect([...can, ...others].filter((item) => item.includes("block a"))).toHaveLength(1);
  });

  it("says a $0 limit is why, not the role", () => {
    const { others } = roleCapabilityLists({ roles: ["SRE", "SUP"], authorityLimit: usd(0) });
    expect(others).toContain("suspend a penalty (your limit is $0)");
  });
});

describe("tool requests in What can I do? (B12)", () => {
  it("lists answering tool requests for the roles the server lets answer, and who else can", () => {
    expect(roleCapabilityLists({ roles: ["SUP"], authorityLimit: null }).can).toContain(
      "answer or decline tool requests, or accept one as a draft tool (its versions need Policy author)",
    );
    const others = roleCapabilityLists({ roles: ["POL"], authorityLimit: null }).others;
    expect(others.some((item) => item.startsWith("answer or decline tool requests, or accept one as a draft tool ("))).toBe(true);
  });
});
