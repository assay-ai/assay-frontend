import { describe, expect, it } from "vitest";

import { dimensionById, groupKeyLabel } from "./period";

describe("Group-by dimensions", () => {
  it("offers agent, which the wire groups by payment_intents.agent_id", () => {
    const agent = dimensionById("agent");
    expect(agent.id).toBe("agent");
    expect(agent.disabled).toBeFalsy();
  });

  it("labels an agent group with the agent's label when one is known", () => {
    const labels = new Map([["f64b7b6e-0d10-4354-b99d-59063875645c", "e2e-agent"]]);
    expect(groupKeyLabel("f64b7b6e-0d10-4354-b99d-59063875645c", "agent", labels)).toBe("e2e-agent");
  });

  it("shortens an agent id it cannot name, as it does a tool id", () => {
    expect(groupKeyLabel("f64b7b6e-0d10-4354-b99d-59063875645c", "agent")).toBe("f64b7b6e…");
  });
});
