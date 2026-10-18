import { afterEach, describe, expect, it, vi } from "vitest";

import { lastKnownSplit, rememberSplit, splitTerms } from "./arbiter-terms";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the penalty view's split when the chain can't be read (B12)", () => {
  const CHAIN = "eip155:46630";

  it("draws the live read when there is one", () => {
    expect(splitTerms({ data: { slashAgentBps: 6000 }, dataUpdatedAt: 5, isError: false }, { terms: { slashAgentBps: 5000 }, readAt: 1 })).toEqual({ agentBps: 6000, readAt: 5, lastKnown: false });
  });

  it("falls back to the last read, saying when, only when the read failed", () => {
    const kept = { terms: { slashAgentBps: 6000 }, readAt: 1_000 };
    expect(splitTerms({ dataUpdatedAt: 0, isError: true }, kept)).toEqual({ agentBps: 6000, readAt: 1_000, lastKnown: true });
    expect(splitTerms({ dataUpdatedAt: 0, isError: false }, kept)).toBeNull();
    expect(splitTerms({ dataUpdatedAt: 0, isError: true }, null)).toBeNull();
  });

  it("keeps the last read per chain in this browser, and survives no storage", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    rememberSplit(CHAIN, { slashAgentBps: 6000 }, 1_000);
    expect(lastKnownSplit(CHAIN, 2_000)).toEqual({ terms: { slashAgentBps: 6000 }, readAt: 1_000 });
    expect(lastKnownSplit("eip155:1", 2_000)).toBeNull();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => rememberSplit(CHAIN, { slashAgentBps: 6000 }, 1_000)).not.toThrow();
    expect(lastKnownSplit(CHAIN)).toBeNull();
  });

  it("ignores a kept split that is out of range, from the future, or over a week old", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    const at = Date.parse("2026-10-18T00:00:00Z");
    for (const bad of [-5, 0, 20_000, 60.5]) {
      rememberSplit(CHAIN, { slashAgentBps: bad }, at);
      expect(lastKnownSplit(CHAIN, at + 1), String(bad)).toBeNull();
    }
    rememberSplit(CHAIN, { slashAgentBps: 6000 }, at);
    expect(lastKnownSplit(CHAIN, at - 1)).toBeNull();
    expect(lastKnownSplit(CHAIN, at + 8 * 86_400_000)).toBeNull();
    expect(lastKnownSplit(CHAIN, at + 86_400_000)).not.toBeNull();
  });
});
