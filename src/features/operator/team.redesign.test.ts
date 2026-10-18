import { describe, expect, it } from "vitest";

import type { OperatorApproval, OperatorRole } from "@/interfaces/operator";

import { actsOnMoney, ROLE_PRESETS, capabilitiesFor } from "./roles";
import { roleName } from "./roles";
import { firstNames, inviteLimit, invitesOf, limitCell, limitMoney, teamTabs } from "./team";
import { approverPhrase } from "./two-person";

const usd = (amount: string) => ({ amount, asset: "eip155:46630", decimals: 6 });
const op = (id: string, name: string, roles: OperatorRole[]) => ({ id, displayName: name, subject: `${id}@`, roles, status: "ACTIVE" as const });

describe("Team limit column", () => {
  it("shows a dash for roles that cannot act on money, and no .00 on whole dollars", () => {
    expect(limitCell({ roles: ["OPS_ADMIN"], authorityLimit: usd("0") })).toBe("—");
    expect(limitCell({ roles: ["ADJL"], authorityLimit: usd("1000000000") })).toBe("$1,000");
    expect(limitCell({ roles: ["ADJ"], authorityLimit: usd("2500000") })).toBe("$2.50");
    expect(limitCell({ roles: ["TRE"], authorityLimit: null })).toBe("No limit");
    expect(actsOnMoney(["SRE", "SUP"])).toBe(true);
    expect(actsOnMoney(["SUP"])).toBe(false);
  });
});

describe("Team invites", () => {
  const approval = (overrides: Partial<OperatorApproval>): OperatorApproval => ({
    id: "apr-add-1",
    action: "operator.add",
    code: "A-12",
    target: "operator_wallet:0x4d2e",
    payload: { body: { subject: "noor@", displayName: "Noor Hassan", roles: ["ADJ"], authorityLimitMinor: "100000000", walletAddress: "0x4d2e8a1c6b9f3e07d5a2c8b1e4f7a0d3c6b9e258" } },
    status: "PENDING",
    requestedBy: "dan@",
    requestedById: "dan",
    approvedBy: null,
    rejectedBy: null,
    createdAt: "2026-10-16T07:00:00.000Z",
    decidedAt: null,
    expiresAt: "2026-10-17T07:00:00.000Z",
    ...overrides,
  });
  const team = [op("dan", "Dan Ortiz", ["OPS_ADMIN"]), op("ava", "Ava Chen", ["OPS_ADMIN"]), op("jordan", "Jordan Blake", ["ADJL"])];

  it("lists a pending addition with who it waits for (not the requester)", () => {
    const [invite] = invitesOf([approval({}), approval({ id: "x", action: "operator.change" }), approval({ id: "y", status: "APPROVED" })], team);
    expect(invite).toMatchObject({ name: "Noor Hassan", subject: "noor@", roles: ["ADJ"], waitingFor: ["Ava Chen"] });
    expect(`Invited · waiting for ${firstNames(invite!.waitingFor)}`).toBe("Invited · waiting for Ava Chen");
    expect(inviteLimit(invite!, "eip155:46630", 6)).toBe("$100");
  });

  it("says who in short names", () => {
    expect(firstNames([])).toBe("a second admin");
    expect(firstNames(["Riley Brooks", "Jordan Blake"])).toBe("Riley or Jordan");
    expect(firstNames(["Riley Brooks", "Jordan Blake", "Iris Park"])).toBe("Riley or 2 others");
  });
});

describe("role picker lines", () => {
  it("are at most 8 words and promise only what the role can do", () => {
    for (const preset of ROLE_PRESETS) {
      expect(preset.short.split(/\s+/).length).toBeLessThanOrEqual(8);
      const caps = capabilitiesFor(preset.roles);
      if (/rules disputes/i.test(preset.short)) expect(caps.rule).toBe(true);
      if (/blocks accounts/i.test(preset.short)) expect(caps.block).toBe(true);
      if (/team/i.test(preset.short)) expect(caps.manageOperators).toBe(true);
    }
    expect(ROLE_PRESETS.find((p) => p.id === "support")!.short).toBe("Blocks accounts; suspends penalties within a limit");
    expect(ROLE_PRESETS.map((p) => p.description).join(" ")).not.toMatch(/fleet sweep/);
  });
});

describe("round 4: Team counts, limits and names", () => {
  it("shows tabs only when Everyone differs from Active, with counts that match the rows", () => {
    expect(teamTabs({ count: 6, more: false }, { count: 6, more: false })).toBeNull();
    expect(teamTabs({ count: 6, more: false }, { count: 7, more: false })).toEqual({ active: "6", everyone: "7" });
    expect(teamTabs({ count: 100, more: true }, { count: 100, more: true })).toBeNull();
    expect(teamTabs(null, { count: 7, more: false })).toBeNull();
  });

  it("writes every limit as whole dollars, cents only when there are some", () => {
    expect(limitMoney(usd("0"))).toBe("$0");
    expect(limitMoney(usd("1000000000"))).toBe("$1,000");
    expect(limitMoney(usd("2500000"))).toBe("$2.50");
  });

  it("names Support / on-call the same way in the role list and in 'needs' sentences", () => {
    expect(roleName("SRE")).toBe("Support / on-call");
    expect(ROLE_PRESETS.find((p) => p.id === "support")!.label).toBe("Support / on-call");
  });

  it("asks for 'a second' approver only when the requester holds that role", () => {
    expect(approverPhrase("A-10", ["SRE", "SUP"])).toBe("a Lead adjudicator");
    expect(approverPhrase("A-10", ["ADJL"])).toBe("a second Lead adjudicator");
    expect(approverPhrase("A-12", ["OPS_ADMIN"])).toBe("a second Admin");
    expect(approverPhrase("A-12", ["ADJL"])).toBe("an Admin");
    expect(approverPhrase("S-1", ["ADJ"])).toBe("a second Adjudicator or Lead adjudicator");
    expect(approverPhrase("X-99", ["ADJ"])).toBe("a second operator");
  });
});

describe("role presets say which dispute each one decides (B12)", () => {
  it("Adjudicators decide buyer call disputes; Treasury prepares arbiter rulings the arbiter key signs", () => {
    const by = (id: string) => ROLE_PRESETS.find((p) => p.id === id)!;
    expect(by("adjudicator").short).toMatch(/^Decides buyer call disputes/);
    expect(by("treasury").short).toMatch(/^Prepares arbiter rulings \(arbiter key signs\)/);
    expect(by("treasury").short).not.toMatch(/call disputes/i);
    expect(by("lead").short).toMatch(/call disputes.*arbiter rulings/);
    for (const preset of ROLE_PRESETS) {
      expect(preset.short).not.toMatch(/rules disputes/i);
      if (/call disputes/i.test(preset.short)) expect(preset.description).toMatch(/decides buyer call disputes/i);
      if (/arbiter rulings/i.test(preset.short)) expect(capabilitiesFor(preset.roles).rule).toBe(true);
    }
    expect(by("treasury").description).toMatch(/prepares arbiter rulings on disputed penalties \(the arbiter key signs\)/i);
    expect(by("treasury").description).not.toMatch(/call disputes/i);
  });
});
