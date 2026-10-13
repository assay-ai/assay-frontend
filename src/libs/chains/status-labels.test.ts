import { describe, expect, it } from "vitest";

import {
  chainCancelReasonCodeLabel,
  chainCancelReasonLabel,
  chainErrorLabel,
  chainStatusLabel,
  describeChainRefusal,
} from "./status-labels";

describe("chainStatusLabel", () => {
  it("says the two states that wait on someone else's signature", () => {
    expect(chainStatusLabel("DISPUTED")).toBe("Disputed on chain — awaiting arbiter");
    expect(chainStatusLabel("CANCEL_REQUESTED")).toBe("Cancel requested — arbiter/admin to sign");
  });

  it("names the others, and prints an unknown value as it came", () => {
    expect(chainStatusLabel("PENDING")).toBe("Pending on chain");
    expect(chainStatusLabel("CANCELLED")).toBe("Cancelled on chain");
    expect(chainStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(chainStatusLabel(null)).toBe("Not reported");
    expect(chainStatusLabel(undefined)).toBe("Not reported");
  });
});

describe("cancel reasons", () => {
  it("says DISPUTE_UNRESOLVED, by name and by the contract's enum value", () => {
    expect(chainCancelReasonLabel("DISPUTE_UNRESOLVED")).toBe("Dispute unresolved (30 days)");
    expect(chainCancelReasonCodeLabel(3)).toBe("Dispute unresolved (30 days)");
  });

  it("names the older three and says when it does not know one", () => {
    expect(chainCancelReasonLabel("WITHDRAWN")).toMatch(/withdrawn/i);
    expect(chainCancelReasonCodeLabel(1)).toMatch(/expired/i);
    expect(chainCancelReasonCodeLabel(2)).toMatch(/verifier/i);
    expect(chainCancelReasonCodeLabel(8)).toBe("Unknown reason (8)");
    expect(chainCancelReasonLabel(null)).toBeNull();
  });
});

describe("chain refusals", () => {
  it("labels a pause and an on-chain block", () => {
    expect(chainErrorLabel("CHAIN_PROGRAM_PAUSED")).toBe("Contracts paused — try after unpause");
    expect(chainErrorLabel("CHAIN_ADDRESS_BLOCKED")).toBe("Blocked on chain");
    expect(chainErrorLabel("OPERATOR_SUSPENDED")).toBeNull();
  });

  it("leads code · message with the label when there is one", () => {
    expect(describeChainRefusal({ code: "CHAIN_PROGRAM_PAUSED", message: "The settlement contracts are paused" })).toBe(
      "Contracts paused — try after unpause · CHAIN_PROGRAM_PAUSED · The settlement contracts are paused",
    );
    expect(describeChainRefusal({ code: "X", message: "y" })).toBe("X · y");
  });
});
