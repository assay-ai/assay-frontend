import { describe, expect, it } from "vitest";

import type { Money } from "@/interfaces";

import { budgetFormFrom, budgetPatch, plainActor } from "./budget-form";

const usd = (atomic: string): Money => ({ amount: atomic, asset: "eip155:1/erc20:0xa", decimals: 6 });
const policy = {
  perCallMax: usd("10000000"),
  dailyCap: usd("75000000"),
  monthlyCap: usd("900000000"),
  maxCallsPerMinute: 30,
  maxCallsPerHour: 400,
  maxSpendPerHour: usd("25000000"),
  allowedTools: null,
  requireApprovalAbove: usd("25000000"),
};

describe("budgetPatch", () => {
  it("sends only what changed, with a default reason", () => {
    const form = { ...budgetFormFrom(policy), perDay: "50" };
    const result = budgetPatch(form, policy, 6, false);
    expect(result).toEqual({ ok: true, changed: true, body: { dailyCap: "50000000", changeReason: "Spending limits changed" } });
  });

  it("clears a limit when the field is emptied, and knows when nothing changed", () => {
    expect(budgetPatch({ ...budgetFormFrom(policy), perMonth: "" }, policy, 6, false)).toMatchObject({
      ok: true,
      body: { monthlyCap: null },
    });
    expect(budgetPatch(budgetFormFrom(policy), policy, 6, false)).toMatchObject({ ok: true, changed: false });
  });

  it("checks that call ≤ day ≤ month and that a tool list is not empty", () => {
    const bad = budgetPatch({ ...budgetFormFrom(policy), perCall: "80", perMonth: "10" }, policy, 6, false);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.perCall).toMatch(/whole day/);
      expect(bad.errors.perDay).toMatch(/whole month/);
    }
    const noTools = budgetPatch({ ...budgetFormFrom(policy), toolsMode: "only", tools: [] }, policy, 6, false);
    expect(noTools.ok).toBe(false);
  });

  it("writes the tool list by id and clears the older refuse-above rule on request", () => {
    const result = budgetPatch(
      { ...budgetFormFrom(policy), toolsMode: "only", tools: ["t1", "t1", "t2"], clearRefuseAbove: true, reason: "pilot" },
      policy,
      6,
      false,
    );
    expect(result).toMatchObject({ ok: true, body: { allowedTools: ["t1", "t2"], requireApprovalAbove: null, changeReason: "pilot" } });
  });
});

describe("plainActor", () => {
  it("never shows the raw agent id", () => {
    expect(plainActor("agent:f64b7b6e")).toBe("An agent key");
    expect(plainActor(null)).toBe("Assay");
    expect(plainActor("ops@example.com")).toBe("ops@example.com");
  });
});
