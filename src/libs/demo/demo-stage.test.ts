import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoResponse } from "./demo-api";
import { rememberDemoDelegateCaps, rememberDemoPolicy, resetDemoStage, withDemoPolicy } from "./demo-stage";

const prevFlag = process.env.NEXT_PUBLIC_DEMO_CHAINS;
const tab = { location: { search: "" }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
  vi.stubGlobal("window", tab);
  resetDemoStage();
});
afterEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = prevFlag;
  vi.unstubAllGlobals();
  resetDemoStage();
});

describe("demo stage: actions show until reload", () => {
  it("keeps Pause all paused on the next fetch", () => {
    expect((demoResponse("GET", "/spend-policy") as { paused: boolean }).paused).toBe(false);
    demoResponse("PATCH", "/spend-policy", {}, { paused: true, changeReason: "Paused all paid calls" });
    expect((demoResponse("GET", "/spend-policy") as { paused: boolean }).paused).toBe(true);
  });

  it("keeps Pause all paused after a reload, for the tab (final regression P3-d)", () => {
    const store = new Map<string, string>();
    const session = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    vi.stubGlobal("window", { location: { search: "" }, sessionStorage: session });
    demoResponse("PATCH", "/spend-policy", {}, { paused: true, changeReason: "Paused all paid calls" });
    resetDemoStage(); // a reload: the module's memory is gone, the tab's storage is not
    expect((demoResponse("GET", "/spend-policy") as { paused: boolean }).paused).toBe(true);
    demoResponse("PATCH", "/spend-policy", {}, { paused: false });
    resetDemoStage();
    expect((demoResponse("GET", "/spend-policy") as { paused: boolean }).paused).toBe(false);
  });

  it("still pauses until reload when storage is blocked or holds junk", () => {
    const blocked = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    vi.stubGlobal("window", { location: { search: "" }, sessionStorage: blocked });
    expect(withDemoPolicy({ paused: false }).paused).toBe(false);
    rememberDemoPolicy({ paused: true });
    expect(withDemoPolicy({ paused: false }).paused).toBe(true);
  });

  it("shows a saved agent spending limit", () => {
    const before = demoResponse("GET", "/escrow/delegates") as { delegates: { delegate: string }[] };
    const delegate = before.delegates[0]!.delegate;
    rememberDemoDelegateCaps(delegate, { maxVoucherAmount: "3000000", maxPerWindow: "50000000" });
    const after = demoResponse("GET", "/escrow/delegates") as { delegates: { maxVoucherAmount: { amount: string } }[] };
    expect(after.delegates[0]!.maxVoucherAmount.amount).toBe("3000000");
  });

  it("answers the debts list with the tool's catalogue id, as the call list does", () => {
    const debts = (demoResponse("GET", "/escrow/debts") as { debts: { toolId: string }[] }).debts;
    expect(debts[0]!.toolId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
