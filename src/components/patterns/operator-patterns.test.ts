import { describe, expect, it } from "vitest";

import { approverNames, expiryReading } from "./approval-footer";
import { noteCounter } from "./reason-chips";
import { numericChainId, safeBatchFile, safeBatchFileName } from "./safe-batch";

describe("approverNames", () => {
  it("joins with 'or' and caps the list", () => {
    expect(approverNames(undefined)).toBeNull();
    expect(approverNames([])).toBeNull();
    expect(approverNames(["Alice"])).toBe("Alice");
    expect(approverNames(["Alice", "Bob"])).toBe("Alice or Bob");
    expect(approverNames(["A", "B", "C", "D"])).toBe("A, B, C or D");
    expect(approverNames(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C or 3 others");
  });
});

describe("expiryReading", () => {
  const created = "2026-10-16T00:00:00Z";
  const expires = "2026-10-17T00:00:00Z";
  it("reads the share left and the time", () => {
    const r = expiryReading(created, expires, Date.parse("2026-10-16T18:00:00Z"));
    expect(r?.left).toBeCloseTo(0.25);
    expect(r?.label).toBe("Expires in 6h 0m");
    expect(r?.urgent).toBe(false);
  });
  it("is urgent under a quarter and expired after", () => {
    expect(expiryReading(created, expires, Date.parse("2026-10-16T20:00:00Z"))?.urgent).toBe(true);
    expect(expiryReading(created, expires, Date.parse("2026-10-17T01:00:00Z"))).toMatchObject({ expired: true, label: "Expired", left: 0 });
  });
  it("is null without a readable end", () => {
    expect(expiryReading(created, null)).toBeNull();
    expect(expiryReading(created, "not a date")).toBeNull();
  });
});

describe("noteCounter", () => {
  it("counts toward the minimum, then plain", () => {
    expect(noteCounter(12, 20)).toEqual({ text: "12 / 20 minimum", short: true, long: false });
    expect(noteCounter(34, 20)).toEqual({ text: "34 characters", short: false, long: false });
    expect(noteCounter(5000, 20, 4096)).toMatchObject({ long: true, text: "5,000 / 4,096 maximum" });
  });
});

describe("safe batch", () => {
  it("writes the Transaction Builder shape", () => {
    const file = safeBatchFile({
      chainId: "eip155:46630",
      name: "Assay · cancelSlashBatch",
      transactions: [{ to: "0xabc", value: "0", data: "0x1234" }],
      createdAt: 1,
    });
    expect(file).toEqual({
      version: "1.0",
      chainId: "46630",
      createdAt: 1,
      meta: { name: "Assay · cancelSlashBatch", description: "", txBuilderVersion: "1.16.5" },
      transactions: [{ to: "0xabc", value: "0", data: "0x1234", contractMethod: null, contractInputsValues: null }],
    });
  });
  it("names the file and strips the chain namespace", () => {
    expect(numericChainId("8453")).toBe("8453");
    expect(safeBatchFileName("cancelSlash Batch", "eip155:46630", new Date("2026-10-16T10:00:00Z"))).toBe(
      "assay-cancelSlashBatch-46630-2026-10-16.json",
    );
  });
});
