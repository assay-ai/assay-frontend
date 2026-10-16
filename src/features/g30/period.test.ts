import { describe, expect, it } from "vitest";

import { credentialGroupLabels, dimensionById, groupKeyLabel, summaryGroupBy, windowIdFromQuery } from "./period";

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

/**
 * U02: two credentials of one agent (1c8f3441… "e2e-agent" and dabfe5ed…
 * "e2e-agent-2", each bound to its own delegate key) were ONE group under
 * "Group by agent", because the summary grouped by agent id.
 */
describe("Group by agent — one row per agent credential", () => {
  const AGENT = "f64b7b6e-0d10-4354-b99d-59063875645c";
  const labels = credentialGroupLabels([{ agentId: AGENT, label: "buyer@example.com" }], {
    [AGENT]: [
      { id: "1c8f3441-54cf-4562-a7f3-e8fbcd5b2050", name: "e2e-agent" },
      { id: "dabfe5ed-4214-4f85-81a9-0b8f7c83b57d", name: "e2e-agent-2" },
    ],
  });

  it("asks the summary to group by credential", () => {
    expect(summaryGroupBy("agent")).toBe("credential");
    expect(summaryGroupBy("tool")).toBe("tool");
  });

  it("names each credential's row by its agent and its own name", () => {
    expect(groupKeyLabel("1c8f3441-54cf-4562-a7f3-e8fbcd5b2050", "agent", labels)).toBe(
      "buyer@example.com · e2e-agent",
    );
    expect(groupKeyLabel("dabfe5ed-4214-4f85-81a9-0b8f7c83b57d", "agent", labels)).toBe(
      "buyer@example.com · e2e-agent-2",
    );
  });

  it("names a row from before calls recorded a credential by its agent", () => {
    expect(groupKeyLabel(`agent:${AGENT}`, "agent", labels)).toBe("buyer@example.com");
    expect(groupKeyLabel(`agent:${AGENT}`, "agent")).toBe("f64b7b6e…");
  });
});

describe("windowIdFromQuery (/spend?range=24h, review 2026-10-17)", () => {
  it("opens the window a link asks for", () => {
    expect(windowIdFromQuery("24h")).toBe("24h");
    expect(windowIdFromQuery("", "30D")).toBe("30d");
  });

  it("ignores a window the page does not offer", () => {
    expect(windowIdFromQuery("1y")).toBeNull();
    expect(windowIdFromQuery(null, undefined, "")).toBeNull();
  });
});
