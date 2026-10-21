import { describe, expect, it } from "vitest";

import { agentDefault, letAgentPayTitle } from "./let-agent-pay-sheet";

describe("agentDefault (spec §9.6: the sheet opens on Light)", () => {
  it("is Light with no account ceiling", () => {
    expect(agentDefault(null)).toEqual({ perCall: "0.50", perDay: "5" });
  });

  it("never exceeds a lower account ceiling", () => {
    expect(agentDefault({ perCall: "0.25", perDay: "2" })).toEqual({ perCall: "0.25", perDay: "2" });
    expect(agentDefault({ perCall: "1", perDay: "20" })).toEqual({ perCall: "0.50", perDay: "5" });
  });
});

describe("letAgentPayTitle (BUG-M3-03: the title matches the state)", () => {
  it("is Let … pay for a key not authorised yet", () => {
    expect(letAgentPayTitle("My agent", false)).toBe("Let My agent pay");
    expect(letAgentPayTitle("My agent", false, "limits")).toBe("Let My agent pay");
  });

  it("is about its limits on an active permission, Renew only when renewing", () => {
    expect(letAgentPayTitle("My agent", true, "limits")).toBe("My agent's payment limits");
    expect(letAgentPayTitle("My agent", true, "renew")).toBe("Renew My agent's permission to pay");
    expect(letAgentPayTitle("My agent", true)).toBe("Renew My agent's permission to pay");
  });
});
