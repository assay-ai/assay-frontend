import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/services/public-api", () => ({
  publicApi: { get: (...args: unknown[]) => get(...args) },
}));

const { getPublicReceipt, parsePublicReceipt, PublicReceiptShapeError } = await import("./public-receipt.service");

const money = (amount: string) => ({ amount, asset: "eip155:4663/erc20:0x1", decimals: 6 });

function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "CHARGED",
    tool: { id: "tool-1", name: "weather.now" },
    provider: { id: "prov-1", name: "Acme Data" },
    listedPrice: money("20000"),
    chargedPrice: money("20000"),
    notCharged: null,
    stages: ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK", "SEMANTIC"].map((stage) => ({
      stage,
      status: "PASSED",
      label: "passed",
    })),
    sampling: "1 in 125 calls at this price",
    createdAt: "2026-10-29T10:15:00.000Z",
    settledAt: "2026-10-29T10:16:00.000Z",
    ...over,
  };
}

beforeEach(() => get.mockReset());

describe("parsePublicReceipt", () => {
  it("keeps exactly the allowed keys, at every level", () => {
    const body = wire({ agentAccount: "0xabc", requestBody: { q: 1 } });
    (body.tool as Record<string, unknown>).ownerWallet = "0xdef";
    (body.listedPrice as Record<string, unknown>).txHash = "0x123";
    (body.stages as Record<string, unknown>[])[0]!.detail = "internal detail";

    const parsed = parsePublicReceipt(body);

    expect(Object.keys(parsed).sort()).toEqual(
      ["chargedPrice", "createdAt", "listedPrice", "notCharged", "provider", "sampling", "settledAt", "stages", "status", "tool"].sort(),
    );
    expect(Object.keys(parsed.tool!)).toEqual(["id", "name"]);
    expect(Object.keys(parsed.listedPrice)).toEqual(["amount", "asset", "decimals"]);
    expect(Object.keys(parsed.stages[0]!)).toEqual(["stage", "status", "label"]);
    expect(JSON.stringify(parsed)).not.toMatch(/0xabc|0xdef|0x123|internal detail|requestBody/);
  });

  it("builds a new object, never the response itself", () => {
    const body = wire();
    const parsed = parsePublicReceipt(body);
    expect(parsed).not.toBe(body);
    expect(parsed.tool).not.toBe(body.tool);
    expect(parsed.stages).not.toBe(body.stages);
  });

  it("keeps null tool and provider, and a not-charged reason", () => {
    const parsed = parsePublicReceipt(
      wire({
        status: "NOT_CHARGED",
        tool: null,
        provider: null,
        chargedPrice: money("0"),
        notCharged: { reason: "FAILED_CHECKS", text: "The result failed a check.", extra: "x" },
        settledAt: null,
        sampling: null,
      }),
    );
    expect(parsed.tool).toBeNull();
    expect(parsed.provider).toBeNull();
    expect(parsed.notCharged).toEqual({ reason: "FAILED_CHECKS", text: "The result failed a check." });
    expect(parsed.settledAt).toBeNull();
    expect(parsed.sampling).toBeNull();
  });

  it("strips control characters and caps names", () => {
    const parsed = parsePublicReceipt(wire({ tool: { id: "t", name: `a\u0000b‮c${"x".repeat(200)}` } }));
    expect(parsed.tool!.name.startsWith("abc")).toBe(true);
    expect(parsed.tool!.name.length).toBe(80);
  });

  it.each([
    ["an unknown status", { status: "SETTLED" }],
    ["a missing tool key", { tool: undefined }],
    ["a non-numeric amount", { listedPrice: money("1e5") }],
    ["no stages", { stages: [] }],
    ["an unknown stage", { stages: ["SCHEMA", "X", "CROSS_CHECK", "SEMANTIC"].map((stage) => ({ stage, status: "PASSED", label: "passed" })) }],
    ["a bad date", { createdAt: "yesterday" }],
  ])("refuses %s", (_name, over) => {
    expect(() => parsePublicReceipt(wire(over))).toThrow(PublicReceiptShapeError);
  });

  it("refuses something that is not an object", () => {
    expect(() => parsePublicReceipt(null)).toThrow(PublicReceiptShapeError);
    expect(() => parsePublicReceipt([])).toThrow(PublicReceiptShapeError);
  });
});

describe("getPublicReceipt", () => {
  it("reads the public route and parses the answer", async () => {
    get.mockResolvedValue(wire({ secret: "s" }));
    const receipt = await getPublicReceipt("abc/def");
    expect(get).toHaveBeenCalledWith("/public/receipts/abc%2Fdef");
    expect("secret" in receipt).toBe(false);
  });
});
