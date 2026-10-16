import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import { isRailNotOffered, railNotOfferedText, servesPaidCalls } from "./paid-rails";

describe("servesPaidCalls", () => {
  it("is false on every Solana chain: paid rails A and B are off there", () => {
    expect(servesPaidCalls("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toBe(false);
    expect(servesPaidCalls("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe(false);
  });

  it("is true on an eip155 chain", () => {
    expect(servesPaidCalls("eip155:46630")).toBe(true);
  });
});

describe("the 409 CHAIN_RAIL_NOT_OFFERED", () => {
  const refusal = new ApiError(
    "CHAIN_RAIL_NOT_OFFERED",
    "Chain solana:EtWT… offers no paid rail right now: only free calls can be served on it.",
    409,
  );

  it("is recognised by its code", () => {
    expect(isRailNotOffered(refusal)).toBe(true);
    expect(isRailNotOffered(new ApiError("OTHER", "x", 409))).toBe(false);
    expect(isRailNotOffered(new Error("CHAIN_RAIL_NOT_OFFERED"))).toBe(false);
  });

  it("reads in plain words, naming the chain and no CAIP-2 id", () => {
    const text = railNotOfferedText("Solana devnet");
    expect(text).toContain("Solana devnet currently serves free calls only");
    expect(text).not.toContain("solana:");
    expect(railNotOfferedText(null)).toMatch(/^This chain currently serves free calls only/);
  });
});
