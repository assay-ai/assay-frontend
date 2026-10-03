import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { toChainsResult } from "./useChains";

const SOLANA = { chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" } as Chain;

describe("toChainsResult — the list is never assumed", () => {
  it("is ready with exactly what the API served, in the API's order", () => {
    const evm = { chainId: "eip155:46630" } as Chain;
    const result = toChainsResult({
      isPending: false,
      isError: false,
      data: { chains: [SOLANA, evm] },
    });
    expect(result.status).toBe("ready");
    expect(result.chains.map((c) => c.chainId)).toEqual([
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "eip155:46630",
    ]);
  });

  it("is EMPTY while loading — not a default, not a guess, not last time's answer", () => {
    // The failure mode is a user shown a chain the API then refuses. A hook
    // that seeded itself with Solana would reproduce it one render deep, and
    // the deposit picker would offer a chain on a deployment that has it off.
    const result = toChainsResult({ isPending: true, isError: false, data: undefined });
    expect(result.status).toBe("loading");
    expect(result.chains).toEqual([]);
  });

  it("is EMPTY on error, and says error rather than ready-with-nothing", () => {
    // "ready, zero chains" and "we could not ask" need opposite screens: one
    // says this deployment offers nothing, the other says try again.
    const result = toChainsResult({ isPending: false, isError: true, data: undefined });
    expect(result.status).toBe("error");
    expect(result.chains).toEqual([]);
  });

  it("is ready-with-zero when the API genuinely serves an empty list", () => {
    const result = toChainsResult({ isPending: false, isError: false, data: { chains: [] } });
    expect(result.status).toBe("ready");
    expect(result.chains).toEqual([]);
  });
});
