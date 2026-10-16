import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { servesPaidCalls } from "@/libs/chains/paid-rails";

import { demoResponse } from "./demo-api";
import {
  DEMO_SWITCH_CHAIN_ID,
  demoFreeOnlyChain,
  demoTightenDelaySeconds,
  parseRailsSwitch,
  parseTightenSwitch,
} from "./demo-switches";
import { DEMO_CHAIN_ID } from "./fixtures";

/* A browser tab, as far as the switches read one: the query and the tab's storage. */
const tab = { location: { search: "" }, sessionStorage: memoryStorage() };

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

function visit(search: string) {
  tab.location.search = search;
}

const prevFlag = process.env.NEXT_PUBLIC_DEMO_CHAINS;

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
  tab.sessionStorage.clear();
  visit("");
  vi.stubGlobal("window", tab);
});

afterEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = prevFlag;
  vi.unstubAllGlobals();
});

describe("demo switch parsing", () => {
  it("reads only the known rails values", () => {
    expect(parseRailsSwitch("free-only")).toBe("free-only");
    expect(parseRailsSwitch("paid")).toBe("paid");
    expect(parseRailsSwitch("all")).toBe("paid");
    expect(parseRailsSwitch("solana")).toBeNull();
    expect(parseRailsSwitch(null)).toBeNull();
  });

  it("reads a tighten delay as seconds", () => {
    expect(parseTightenSwitch("1h")).toBe(3600);
    expect(parseTightenSwitch("30m")).toBe(1800);
    expect(parseTightenSwitch("90s")).toBe(90);
    expect(parseTightenSwitch("3600")).toBe(3600);
    expect(parseTightenSwitch("0")).toBe(0);
    expect(parseTightenSwitch("off")).toBe(0);
    expect(parseTightenSwitch("soon")).toBeNull();
    expect(parseTightenSwitch(null)).toBeNull();
  });

  it("switches the demo account's own chain", () => {
    expect(DEMO_SWITCH_CHAIN_ID).toBe(DEMO_CHAIN_ID);
  });
});

describe("?rails=free-only", () => {
  it("makes the demo chain free-calls-only, kept for the tab until ?rails=paid", () => {
    expect(servesPaidCalls(DEMO_CHAIN_ID)).toBe(true);
    visit("?rails=free-only");
    expect(servesPaidCalls(DEMO_CHAIN_ID)).toBe(false);
    visit("");
    expect(demoFreeOnlyChain(DEMO_CHAIN_ID)).toBe(true);
    expect(servesPaidCalls("eip155:1")).toBe(true);
    visit("?rails=paid");
    expect(servesPaidCalls(DEMO_CHAIN_ID)).toBe(true);
    visit("");
    expect(servesPaidCalls(DEMO_CHAIN_ID)).toBe(true);
  });

  it("does nothing outside a demo build", () => {
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "";
    visit("?rails=free-only");
    expect(servesPaidCalls(DEMO_CHAIN_ID)).toBe(true);
  });
});

describe("?tighten=", () => {
  it("gives the demo escrow a tighten delay, kept for the tab until ?tighten=0", () => {
    expect(demoTightenDelaySeconds()).toBe(0);
    visit("?tighten=1h");
    expect(demoTightenDelaySeconds()).toBe(3600);
    visit("");
    const delegates = demoResponse("GET", "/escrow/delegates", {}) as { tightenDelaySeconds?: number };
    expect(delegates.tightenDelaySeconds).toBe(3600);
    const unsettled = demoResponse("GET", "/escrow/unsettled", {}) as { tightenDelaySeconds?: number };
    expect(unsettled.tightenDelaySeconds).toBe(3600);
    visit("?tighten=0");
    expect(demoTightenDelaySeconds()).toBe(0);
    visit("");
    expect((demoResponse("GET", "/escrow/delegates", {}) as { tightenDelaySeconds?: number }).tightenDelaySeconds).toBe(0);
  });
});
