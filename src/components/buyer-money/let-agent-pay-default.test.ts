import { describe, expect, it } from "vitest";

import { agentDefault } from "./let-agent-pay-sheet";

describe("agentDefault (spec §9.6: the sheet opens on Light)", () => {
  it("is Light with no account ceiling", () => {
    expect(agentDefault(null)).toEqual({ perCall: "0.50", perDay: "5" });
  });

  it("never exceeds a lower account ceiling", () => {
    expect(agentDefault({ perCall: "0.25", perDay: "2" })).toEqual({ perCall: "0.25", perDay: "2" });
    expect(agentDefault({ perCall: "1", perDay: "20" })).toEqual({ perCall: "0.50", perDay: "5" });
  });
});
