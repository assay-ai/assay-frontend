import { describe, expect, it } from "vitest";

import { operatorEventSummary } from "./case-history";

const context = { asset: "eip155:46630/erc20:0xabc", decimals: 6, toolName: "get_weather", bindingId: "71ca227c-1a4c-4c49-bb53-652135eae47f" };

describe("operator penalty History (BUG-OPS-CASES-03)", () => {
  it("writes the stake line in dollars, not minor units", () => {
    expect(operatorEventSummary("Penalty of 28470000 taken from stake", context)).toBe("Penalty of $28.47 taken from stake");
  });

  it("reads an older proposal row: money, and the tool instead of the binding id", () => {
    expect(operatorEventSummary(`Slash proposed: 28470000 against ${context.bindingId}`, context)).toBe(
      "Penalty of $28.47 proposed against get_weather",
    );
    expect(operatorEventSummary("Slash proposed: 28470000 against 00000000-0000-0000-0000-000000000000", context)).toBe(
      "Penalty of $28.47 proposed against the binding",
    );
  });

  it("names the tool on a newer dollar row and formats an older de-minimis row", () => {
    expect(operatorEventSummary("Penalty of $28.47 proposed", context)).toBe("Penalty of $28.47 proposed against get_weather");
    expect(operatorEventSummary("Penalty of 5000000 is below the de-minimis floor; recorded, not levied", context)).toBe(
      "Penalty of $5.00 is below the de-minimis floor; recorded, not levied",
    );
    expect(operatorEventSummary("28470000 of stake is reserved on chain", context)).toBe("$28.47 of stake is reserved on chain");
  });

  it("leaves any other sentence as it is", () => {
    expect(operatorEventSummary("Penalty of $5.00 is below the de-minimis floor; recorded, not levied", context)).toBe(
      "Penalty of $5.00 is below the de-minimis floor; recorded, not levied",
    );
    expect(operatorEventSummary("Assigned to riley", context)).toBe("Assigned to riley");
  });
});
