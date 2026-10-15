import { describe, expect, it } from "vitest";

import {
  cancelRequestedLabel,
  cancelSignerOf,
  caseChainDisputePhase,
  caseChainStatusLabel,
  chainCancelReasonCodeLabel,
  chainCancelReasonLabel,
  chainErrorLabel,
  chainStatusLabel,
  describeChainRefusal,
} from "./status-labels";

const SOLANA_ASSET =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

describe("chainStatusLabel", () => {
  it("says the two states that wait on someone else's signature", () => {
    expect(chainStatusLabel("DISPUTED")).toBe("Disputed on chain — awaiting arbiter");
  });

  it("names who signs a requested cancel, by chain", () => {
    expect(chainStatusLabel("CANCEL_REQUESTED", "eip155:46630")).toBe("Cancel requested — arbiter to sign");
    expect(chainStatusLabel("CANCEL_REQUESTED", "eip155:46630/erc20:0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c")).toBe(
      "Cancel requested — arbiter to sign",
    );
    expect(chainStatusLabel("CANCEL_REQUESTED", SOLANA_ASSET)).toBe("Cancel requested — program admin to sign");
    expect(chainStatusLabel("CANCEL_REQUESTED")).toBe(
      "Cancel requested — arbiter (EVM) or program admin (Solana) to sign",
    );
    expect(cancelRequestedLabel("cosmos:x")).toBe(chainStatusLabel("CANCEL_REQUESTED", null));
  });

  it("names the cancel signer, by chain", () => {
    expect(cancelSignerOf("eip155:8453")).toBe("the arbiter");
    expect(cancelSignerOf(SOLANA_ASSET)).toBe("the program admin");
    expect(cancelSignerOf(undefined)).toBe("the arbiter (EVM) or the program admin (Solana)");
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
    expect(chainCancelReasonLabel("WITHDRAWN")).toMatch(/arbiter/i);
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

  it("puts a contract error the message names in words first", () => {
    expect(
      describeChainRefusal({ code: "SLASH_EXECUTION_FAILED", message: "executeSlash reverts SlashWindowNotDrained" }),
    ).toBe(
      "Waiting until today's penalty limit has room; it will be paid in full. The penalty stays pending until then. · SLASH_EXECUTION_FAILED · executeSlash reverts SlashWindowNotDrained",
    );
    expect(describeChainRefusal({ code: "X", message: "setBlocked reverts ArbiterCannotUnblock" })).toMatch(
      /^The arbiter can only block\./,
    );
  });
});

describe("caseChainDisputePhase and caseChainStatusLabel", () => {
  const disputedAt = "2026-10-15T08:58:08.000Z";

  it("reads PENDING with a disputedAt and no disputed part as upheld", () => {
    const mirror = { chainStatus: "PENDING", chainDisputedAt: disputedAt, chainDisputedParts: 0 };
    expect(caseChainDisputePhase(mirror)).toBe("upheld");
    expect(caseChainStatusLabel(mirror, "eip155:46630")).toBe("Upheld by Assay's arbiter");
  });

  it("keeps a never-disputed PENDING record Pending", () => {
    const mirror = { chainStatus: "PENDING", chainDisputedAt: null, chainDisputedParts: 0 };
    expect(caseChainDisputePhase(mirror)).toBe("none");
    expect(caseChainStatusLabel(mirror)).toBe("Pending on chain");
  });

  it("names DISPUTED and a partly disputed PENDING case", () => {
    expect(caseChainDisputePhase({ chainStatus: "DISPUTED", chainDisputedAt: disputedAt, chainDisputedParts: 1 })).toBe(
      "disputed",
    );
    expect(caseChainStatusLabel({ chainStatus: "DISPUTED" })).toBe("Disputed on chain — awaiting arbiter");
    expect(caseChainDisputePhase({ chainStatus: "PENDING", chainDisputedAt: disputedAt, chainDisputedParts: 2 })).toBe(
      "partly-disputed",
    );
  });

  it("leaves closed records and an older backend alone", () => {
    expect(caseChainStatusLabel({ chainStatus: "EXECUTED", chainDisputedAt: disputedAt })).toBe("Executed on chain");
    expect(caseChainDisputePhase({})).toBe("none");
    expect(caseChainStatusLabel({})).toBe("Not reported");
  });
});
