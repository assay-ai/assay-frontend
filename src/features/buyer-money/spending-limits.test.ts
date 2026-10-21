import { describe, expect, it } from "vitest";

import type { EscrowDelegate, Money } from "@/interfaces";

import {
  accountDefaultError,
  agentLimitRows,
  canUseAccountDefault,
  budgetAgentId,
  ceilingCountsMoreThanAgents,
  hasOldBudget,
  HARD_STOP,
  LIMIT_SOURCE,
  limitLines,
  limitSentence,
} from "./spending-limits";

const usd = (major: string): Money => ({ amount: String(Math.round(Number(major) * 1_000_000)), asset: "eip155:1/erc20:0xa", decimals: 6 });
const grant = (call: string, day: string, spent = "0", status: EscrowDelegate["status"] = "ACTIVE"): EscrowDelegate => ({
  delegate: "eip155:1:0xd",
  maxVoucherAmount: usd(call),
  maxPerWindow: usd(day),
  spentInWindow: usd(spent),
  validUntil: "2027-01-01T00:00:00Z",
  status,
  unsettled: { count: 0, amount: usd("0"), largest: usd("0"), windowNeeds: usd("0"), redeemableUntil: null },
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
    expect(lines.map((l) => l.stop)).toEqual([HARD_STOP.chain, HARD_STOP.chain, HARD_STOP.assay]);
  });

  it("names the account ceiling when it is the lower one", () => {
    const [call] = limitLines(agentLimitRows({ delegation: true, grant: grant("20", "40"), policy: null, ceiling }));
    expect(limitSentence(call!)).toBe(`$10.00 a call — set by ${LIMIT_SOURCE.ceiling}`);
    expect(call!.stop).toBe(HARD_STOP.chain);
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
    expect(lines.every((l) => l.stop === HARD_STOP.assay)).toBe(true);
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
  it("uses the agent the server names (subjectAgentId), also for an organization default (BUG-BUY-CONNECT-05)", () => {
    expect(budgetAgentId(agents, { agentId: null, subjectAgentId: "b" }, "eip155:1:0xaa")).toBe("b");
    expect(budgetAgentId(agents, { agentId: "a", subjectAgentId: "b" }, null)).toBe("b");
  });
  it("names no agent when the server's subject is not on screen, never another agent", () => {
    expect(budgetAgentId(agents, { agentId: null, subjectAgentId: "zz" }, "eip155:1:0xaa")).toBeNull();
    expect(budgetAgentId([agents[0]!], { agentId: null, subjectAgentId: "zz" }, null)).toBeNull();
  });
});

describe("ceilingCountsMoreThanAgents", () => {
  it("is true only when the ceiling counted more than the agents on screen", () => {
    expect(ceilingCountsMoreThanAgents(usd("2.61"), [usd("0"), null])).toBe(true);
    expect(ceilingCountsMoreThanAgents(usd("15.75"), [usd("15.75")])).toBe(false);
    expect(ceilingCountsMoreThanAgents(null, [usd("1")])).toBe(false);
  });
});

/* Lot 1 B6 (BUG-BUY-CONNECT-05 part 2): "Use account default" drops an agent's own policy. */
describe("Use account default", () => {
  it("is offered only for the agent whose own policy this page read", () => {
    expect(canUseAccountDefault({ scope: "AGENT", agentId: "a1" }, "a1", true)).toBe(true);
    expect(canUseAccountDefault({ scope: "ORGANIZATION", agentId: null }, "a1", true)).toBe(false);
    expect(canUseAccountDefault({ scope: "AGENT", agentId: "a2" }, "a1", true)).toBe(false);
    expect(canUseAccountDefault({ scope: "AGENT", agentId: "a1" }, "a1", false)).toBe(false);
    expect(canUseAccountDefault(null, "a1", true)).toBe(false);
  });

  it("says why a drop was refused, in plain words", () => {
    expect(accountDefaultError({ code: "SPEND_POLICY_DROP_REFUSED", context: { reason: "ACCESS_DIFFERS" } })).toMatch(/own tool access/);
    expect(accountDefaultError({ code: "SPEND_POLICY_DROP_REFUSED", context: { reason: "PAUSED" } })).toMatch(/Resume it first/);
    expect(accountDefaultError({ code: "SPEND_POLICY_NOT_FOUND", status: 404 })).toMatch(/no default limits/);
    expect(accountDefaultError({ code: "AUTH_HUMAN_SESSION_REQUIRED", status: 403 })).toMatch(/signed in yourself/);
    // An older backend has no such route.
    expect(accountDefaultError({ code: "API_NOT_FOUND", status: 404 })).toBe("This server cannot do this yet. Nothing changed.");
    expect(accountDefaultError(null)).toMatch(/try again/);
  });
});
