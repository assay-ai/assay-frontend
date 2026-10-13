import { describe, expect, it } from "vitest";

import { cancelReasonLabel, slashStatusOf } from "./status";

describe("slashStatusOf", () => {
  it("names today's four SlashStatus values", () => {
    expect(slashStatusOf(0)).toMatchObject({ key: "none", needsAttention: false });
    expect(slashStatusOf(1)).toMatchObject({ key: "pending", label: "Pending", needsAttention: true });
    expect(slashStatusOf(2)).toMatchObject({ key: "executed", label: "Executed", needsAttention: false });
    expect(slashStatusOf(3)).toMatchObject({ key: "cancelled", label: "Cancelled", needsAttention: false });
  });

  it("shows 4 as Disputed, ready for the value being appended after Cancelled", () => {
    expect(slashStatusOf(4)).toEqual({ key: "disputed", code: 4, label: "Disputed", needsAttention: true });
  });

  it("accepts a bigint, as some decoders return", () => {
    expect(slashStatusOf(BigInt(4)).key).toBe("disputed");
  });

  it("does not throw on, or guess at, a value it does not know", () => {
    const status = slashStatusOf(9);
    expect(status).toEqual({ key: "unknown", code: 9, label: "Unknown status (9)", needsAttention: true });
    expect(slashStatusOf(-1).key).toBe("unknown");
    expect(slashStatusOf(1.5).key).toBe("unknown");
  });
});

describe("cancelReasonLabel", () => {
  it("names the three CancelReason values", () => {
    expect(cancelReasonLabel(0)).toMatch(/withdrawn/i);
    expect(cancelReasonLabel(1)).toMatch(/expired/i);
    expect(cancelReasonLabel(2)).toMatch(/verifier/i);
  });

  it("says when it does not know a reason, and is null when there is none", () => {
    expect(cancelReasonLabel(7)).toBe("Unknown reason (7)");
    expect(cancelReasonLabel(null)).toBeNull();
    expect(cancelReasonLabel(undefined)).toBeNull();
  });
});
