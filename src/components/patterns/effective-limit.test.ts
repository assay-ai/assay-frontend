import { describe, expect, it } from "vitest";

import type { Money } from "@/interfaces";

import { effectiveSentence, resolveLimit } from "./effective-limit";

const usd = (major: string): Money => ({
  amount: String(Math.round(Number(major) * 1_000_000)),
  asset: "eip155:1/erc20:0xa",
  decimals: 6,
});

describe("resolveLimit", () => {
  it("picks the lowest ceiling and names its source", () => {
    const resolved = resolveLimit([
      { source: "Safety caps", value: usd("1") },
      { source: "Agent permission", value: usd("0.5") },
      { source: "Budget", value: null },
    ]);
    expect(resolved.value?.amount).toBe("500000");
    expect(resolved.source).toBe("Agent permission");
    expect(resolved.left).toBeNull();
  });

  it("works out what is left now from the tightest source", () => {
    const resolved = resolveLimit([
      { source: "Safety caps", value: usd("20"), used: usd("3.4") },
      { source: "Budget", value: usd("10"), used: usd("9") },
    ]);
    expect(resolved.source).toBe("Budget");
    expect(resolved.left?.amount).toBe("1000000");
    expect(resolved.leftSource).toBe("Budget");
  });

  it("never reports a negative amount left", () => {
    expect(resolveLimit([{ source: "Budget", value: usd("1"), used: usd("2") }]).left?.amount).toBe("0");
  });

  it("has no ceiling when no source sets one", () => {
    expect(resolveLimit([{ source: "Budget", value: null }])).toMatchObject({ value: null, source: null });
  });
});

describe("effectiveSentence", () => {
  it("joins the binding ceilings", () => {
    expect(
      effectiveSentence([
        { id: "call", label: "Per call", sources: [{ source: "Budget", value: usd("0.5") }] },
        { id: "day", label: "Per day", sources: [{ source: "Budget", value: usd("10") }] },
      ]),
    ).toBe("At most $0.50 a call and $10.00 a day.");
    expect(effectiveSentence([{ id: "call", label: "Per call", sources: [] }])).toMatch(/No limit/);
  });
});
