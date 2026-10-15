import { describe, expect, it } from "vitest";

import type { EscrowDelegate, Money } from "@/interfaces";

import { agentLimitRows, budgetAgentId, hasOldBudget, LIMIT_SOURCE, limitLines, limitSentence } from "./spending-limits";

const usd = (major: string): Money => ({ amount: String(Math.round(Number(major) * 1_000_000)), asset: "eip155:1/erc20:0xa", decimals: 6 });
const grant = (call: string, day: string, spent = "0", status: EscrowDelegate["status"] = "ACTIVE"): EscrowDelegate => ({
  delegate: "eip155:1:0xd",
  maxVoucherAmount: usd(call),
  maxPerWindow: usd(day),
  spentInWindow: usd(spent),
  validUntil: "2027-01-01T00:00:00Z",
  status,
});
const ceiling = { maxVoucherAmount: usd("10"), maxPerWindow: usd("120"), spentInWindow: usd("15.75") };
const policy = (over: Partial<Record<"perCallMax" | "dailyCap" | "monthlyCap" | "requireApprovalAbove", Money | null>> = {}) => ({
  perCallMax: null,
  dailyCap: null,
  monthlyCap: null,
  requireApprovalAbove: null,
  ...over,
});

describe("spending limits: one effective line per limit, naming what binds", () => {
  it("says the agent's own limit binds when it is below the account ceiling", () => {
    const lines = limitLines(agentLimitRows({ delegation: true, grant: grant("2", "40", "15.75"), policy: policy({ monthlyCap: usd("900") }), spentMonth: usd("127.15"), ceiling }));
    expect(lines.map(limitSentence)).toEqual([
      "$2.00 a call — set by this agent's spending limit",
      "$40.00 per 24 hours — set by this agent's spending limit",
      "$900.00 a month — set by this agent's spending limit",
    ]);
    expect(lines[1]!.left).toBe("$24.25 left now");
  });

  it("names the account ceiling when it is the lower one", () => {
    const [call] = limitLines(agentLimitRows({ delegation: true, grant: grant("20", "40"), policy: null, ceiling }));
    expect(limitSentence(call!)).toBe(`$10.00 a call — set by ${LIMIT_SOURCE.ceiling}`);
  });

  it("names the older rule and older budget only while they are set and lower", () => {
    const rows = agentLimitRows({ delegation: true, grant: grant("2", "40"), policy: policy({ perCallMax: usd("1"), requireApprovalAbove: usd("0.5") }), ceiling });
    expect(limitSentence(limitLines(rows)[0]!)).toBe(`$0.50 a call — set by ${LIMIT_SOURCE.oldRule}`);
    expect(hasOldBudget(policy({ dailyCap: usd("5") }))).toBe(true);
    expect(hasOldBudget(policy())).toBe(false);
  });

  it("an expired permission sets no limit (it cannot pay)", () => {
    const rows = agentLimitRows({ delegation: true, grant: grant("2", "40", "0", "EXPIRED"), policy: null, ceiling: null });
    expect(limitLines(rows)).toEqual([]);
  });

  it("an agent without an on-chain permission is limited by Assay per call and per calendar day", () => {
    const lines = limitLines(agentLimitRows({ delegation: false, grant: null, policy: policy({ perCallMax: usd("1"), dailyCap: usd("5") }), ceiling: null }));
    expect(lines.map((l) => l.amount)).toEqual(["$1.00 a call", "$5.00 a day (UTC)"]);
  });
});

describe("budgetAgentId: the agent whose Assay limits this session can edit", () => {
  const agents = [
    { agentId: "a", agentAccount: "eip155:1:0xAA" },
    { agentId: "b", agentAccount: "eip155:1:0xBB" },
  ];
  it("uses the policy's own agent, else the escrow owner, else the only agent", () => {
    expect(budgetAgentId(agents, { agentId: "b" }, null)).toBe("b");
    expect(budgetAgentId(agents, { agentId: null }, "eip155:1:0xaa")).toBe("a");
    expect(budgetAgentId(agents, null, null)).toBeNull();
    expect(budgetAgentId([agents[0]!], null, null)).toBe("a");
  });
});
