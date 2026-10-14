import { describe, expect, it } from "vitest";

import { cancelReasonLabel, slashRecordStatusOf, slashStatusOf } from "./status";

describe("slashStatusOf", () => {
  it("names today's four SlashStatus values", () => {
    expect(slashStatusOf(0)).toMatchObject({ key: "none", needsAttention: false });
    expect(slashStatusOf(1)).toMatchObject({ key: "pending", label: "Pending", needsAttention: true });
    expect(slashStatusOf(2)).toMatchObject({ key: "executed", label: "Executed", needsAttention: false });
    expect(slashStatusOf(3)).toMatchObject({ key: "cancelled", label: "Cancelled", needsAttention: false });
  });

  it("shows 4 as Disputed, awaiting the arbiter", () => {
    expect(slashStatusOf(4)).toEqual({
      key: "disputed",
      code: 4,
      label: "Disputed on chain — awaiting arbiter",
      needsAttention: true,
    });
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
  it("names the four CancelReason values", () => {
    expect(cancelReasonLabel(0)).toMatch(/withdrawn/i);
    expect(cancelReasonLabel(1)).toMatch(/expired/i);
    expect(cancelReasonLabel(2)).toMatch(/verifier/i);
    expect(cancelReasonLabel(3)).toBe("Dispute unresolved (30 days)");
    expect(cancelReasonLabel(BigInt(3))).toBe("Dispute unresolved (30 days)");
  });

  it("says when it does not know a reason, and is null when there is none", () => {
    expect(cancelReasonLabel(7)).toBe("Unknown reason (7)");
    expect(cancelReasonLabel(null)).toBeNull();
    expect(cancelReasonLabel(undefined)).toBeNull();
  });
});

describe("slashRecordStatusOf", () => {
  it("reads Pending with a dispute behind it as upheld by the arbiter", () => {
    expect(slashRecordStatusOf(1, true)).toEqual({
      key: "upheld",
      code: 1,
      label: "Upheld by Assay's arbiter",
      needsAttention: true,
    });
  });

  it("leaves a never-disputed Pending record Pending", () => {
    expect(slashRecordStatusOf(1, false)).toEqual(slashStatusOf(1));
  });

  it("never changes any other status, disputed or not", () => {
    for (const code of [0, 2, 3, 4, 9]) {
      expect(slashRecordStatusOf(code, true)).toEqual(slashStatusOf(code));
    }
  });
});
